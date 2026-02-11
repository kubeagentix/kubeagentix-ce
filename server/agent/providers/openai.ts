import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import {
  LLMProvider,
  AgentResponseChunk,
  ToolDefinition,
  AgentMessage,
  ModelPreferences,
  AgentError,
  ToolCall,
} from "@shared/coordination";

/**
 * OpenAI function definition format
 */
interface OpenAIFunctionDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

/**
 * Request configuration for OpenAI API calls
 */
interface OpenAIRequestConfig {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  modelPreferences?: ModelPreferences;
}

/**
 * OpenAI Provider implementing LLMProvider interface
 *
 * Features:
 * - Streaming responses via AsyncGenerator
 * - Function calling for tools
 * - GPT-5 family support
 * - Error handling with retries
 */
export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "OpenAI";

  supportedModels = [
    "gpt-5.2",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
  ];
  defaultModel = "gpt-5.2";
  contextWindowSize = 128000;
  supportsStreaming = true;
  supportsToolUse = true;
  supportsVision = true;
  supportsExtendedThinking = false;

  costPer1kInputTokens = 0.01;
  costPer1kOutputTokens = 0.03;

  apiKeyRequired = true;
  priority = 2;

  private client: OpenAI;
  private maxRetries = 3;
  private retryDelayMs = 1000;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new AgentError(
        "MISSING_API_KEY",
        "OPENAI_API_KEY is required for OpenAI provider",
        false
      );
    }
    this.client = new OpenAI({ apiKey: key });
  }

  /**
   * Convert internal tool definitions to OpenAI's function format
   */
  private formatToolsForOpenAI(tools: ToolDefinition[]): OpenAIFunctionDefinition[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  /**
   * Convert internal messages to OpenAI's expected format
   */
  private formatMessagesForOpenAI(
    systemPrompt: string,
    messages: AgentMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    const formatted: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of messages) {
      formatted.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    return formatted;
  }

  /**
   * Stream response chunks from OpenAI API
   */
  async *streamResponse(
    config: OpenAIRequestConfig
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;

    const requestParams: OpenAI.ChatCompletionCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: this.formatMessagesForOpenAI(systemPrompt, messages),
      tools: this.formatToolsForOpenAI(tools),
      tool_choice: "auto",
    };

    let retryCount = 0;
    while (retryCount <= this.maxRetries) {
      try {
        const stream = await this.client.chat.completions.create(requestParams);

        // Track tool calls being accumulated
        const toolCalls: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Handle text content
          if (delta.content) {
            yield {
              type: "text",
              chunkId: uuidv4(),
              timestamp: Date.now(),
              text: delta.content,
              isDone: false,
            };
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;

              // Initialize or update tool call
              if (!toolCalls.has(index)) {
                toolCalls.set(index, {
                  id: toolCall.id || "",
                  name: toolCall.function?.name || "",
                  arguments: "",
                });
              }

              const current = toolCalls.get(index)!;

              // Update with new data
              if (toolCall.id) current.id = toolCall.id;
              if (toolCall.function?.name) current.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                current.arguments += toolCall.function.arguments;
              }
            }
          }

          // Check for completion
          if (choice.finish_reason === "tool_calls") {
            // Emit accumulated tool calls
            for (const tc of toolCalls.values()) {
              let args: Record<string, any> = {};
              try {
                args = tc.arguments ? JSON.parse(tc.arguments) : {};
              } catch {
                args = {};
              }

              yield {
                type: "tool_call",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                toolCall: {
                  id: tc.id,
                  name: tc.name,
                  arguments: args,
                } as ToolCall,
              };
            }
          }

          if (choice.finish_reason === "stop") {
            yield {
              type: "text",
              chunkId: uuidv4(),
              timestamp: Date.now(),
              text: "",
              isDone: true,
            };
          }
        }

        // Successfully completed - exit retry loop
        return;
      } catch (error) {
        retryCount++;

        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || retryCount > this.maxRetries) {
          yield {
            type: "error",
            chunkId: uuidv4(),
            timestamp: Date.now(),
            error: {
              code: this.getErrorCode(error),
              message:
                error instanceof Error ? error.message : "Unknown OpenAI API error",
              retryable: isRetryable,
            },
          };
          return;
        }

        // Wait before retry with exponential backoff
        await this.delay(this.retryDelayMs * Math.pow(2, retryCount - 1));
      }
    }
  }

  /**
   * Continue conversation after tool execution
   */
  async *continueWithToolResults(
    config: OpenAIRequestConfig,
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
      isError?: boolean;
    }>
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    // Build messages with tool results
    const formattedMessages: OpenAI.ChatCompletionMessageParam[] = [
      ...this.formatMessagesForOpenAI(systemPrompt, messages),
      // Add assistant message with tool calls (required by OpenAI)
      {
        role: "assistant",
        content: null,
        tool_calls: toolResults.map((tr) => ({
          id: tr.toolCallId,
          type: "function" as const,
          function: {
            name: tr.toolName,
            arguments: "{}",
          },
        })),
      },
      // Add tool results
      ...toolResults.map(
        (tr): OpenAI.ChatCompletionToolMessageParam => ({
          role: "tool",
          tool_call_id: tr.toolCallId,
          content: JSON.stringify(tr.result),
        })
      ),
    ];

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;

    const requestParams: OpenAI.ChatCompletionCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: formattedMessages,
      tools: this.formatToolsForOpenAI(tools),
      tool_choice: "auto",
    };

    try {
      const stream = await this.client.chat.completions.create(requestParams);

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          yield {
            type: "text",
            chunkId: uuidv4(),
            timestamp: Date.now(),
            text: delta.content,
            isDone: false,
          };
        }

        if (choice.finish_reason === "stop") {
          yield {
            type: "text",
            chunkId: uuidv4(),
            timestamp: Date.now(),
            text: "",
            isDone: true,
          };
        }
      }
    } catch (error) {
      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: this.getErrorCode(error),
          message:
            error instanceof Error ? error.message : "Unknown OpenAI API error",
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return (
        error.status === 429 || // Rate limit
        error.status === 500 || // Server error
        error.status === 502 || // Bad gateway
        error.status === 503 || // Service unavailable
        error.status === 504 // Gateway timeout
      );
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("network") ||
        message.includes("timeout") ||
        message.includes("econnreset")
      );
    }

    return false;
  }

  /**
   * Get error code from error
   */
  private getErrorCode(error: unknown): string {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) return "UNAUTHORIZED";
      if (error.status === 403) return "FORBIDDEN";
      if (error.status === 404) return "NOT_FOUND";
      if (error.status === 429) return "RATE_LIMITED";
      if (error.status >= 500) return "SERVER_ERROR";
      return "API_ERROR";
    }

    if (error instanceof Error) {
      if (error.message.includes("timeout")) return "TIMEOUT";
      if (error.message.includes("network")) return "NETWORK_ERROR";
    }

    return "UNKNOWN_ERROR";
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test provider connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create an OpenAI provider instance
 */
export function createOpenAIProvider(apiKey?: string): OpenAIProvider {
  return new OpenAIProvider(apiKey);
}

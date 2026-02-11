import Anthropic from "@anthropic-ai/sdk";
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
 * Claude tool definition format expected by Anthropic API
 */
interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Request configuration for Claude API calls
 */
interface ClaudeRequestConfig {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  modelPreferences?: ModelPreferences;
}

/**
 * Claude Provider implementing LLMProvider interface
 *
 * Features:
 * - Streaming responses via AsyncGenerator
 * - Prompt caching for system prompts and tool definitions
 * - Extended thinking support (10K token budget)
 * - Tool use with proper schema formatting
 * - Error handling with retries
 */
export class ClaudeProvider implements LLMProvider {
  id = "claude";
  name = "Claude (Anthropic)";

  supportedModels = [
    "claude-opus-4-1-20250805",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ];
  defaultModel = "claude-sonnet-4-20250514";
  contextWindowSize = 200000;
  supportsStreaming = true;
  supportsToolUse = true;
  supportsVision = true;
  supportsExtendedThinking = true;

  costPer1kInputTokens = 0.003;
  costPer1kOutputTokens = 0.015;

  apiKeyRequired = true;
  priority = 1;

  private client: Anthropic;
  private maxRetries = 3;
  private retryDelayMs = 1000;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new AgentError(
        "MISSING_API_KEY",
        "ANTHROPIC_API_KEY is required for Claude provider",
        false
      );
    }
    this.client = new Anthropic({ apiKey: key });
  }

  /**
   * Convert internal tool definitions to Claude's expected format
   */
  private formatToolsForClaude(tools: ToolDefinition[]): ClaudeToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  /**
   * Convert internal messages to Claude's expected format
   */
  private formatMessagesForClaude(
    messages: AgentMessage[]
  ): Anthropic.MessageParam[] {
    return messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
  }

  /**
   * Build system prompt with caching for reuse
   * Note: cache_control is part of beta features, cast to any for now
   */
  private buildSystemContent(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): Anthropic.TextBlockParam[] {
    const toolsJson = JSON.stringify(this.formatToolsForClaude(tools), null, 2);

    // Use type assertion for cache_control which is a beta feature
    return [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      } as Anthropic.TextBlockParam,
      {
        type: "text",
        text: `Available tools:\n${toolsJson}`,
        cache_control: { type: "ephemeral" },
      } as Anthropic.TextBlockParam,
    ];
  }

  /**
   * Stream response chunks from Claude API
   */
  async *streamResponse(
    config: ClaudeRequestConfig
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;
    const useExtendedThinking = modelPreferences?.useExtendedThinking ?? false;

    // Build request params
    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      stream: true,
      system: this.buildSystemContent(systemPrompt, tools),
      messages: this.formatMessagesForClaude(messages),
      tools: this.formatToolsForClaude(tools),
    };

    // Add extended thinking if enabled (only for supported models)
    if (useExtendedThinking && this.supportsExtendedThinking) {
      // Extended thinking requires specific configuration
      // Using thinking block for complex reasoning
      (requestParams as any).thinking = {
        type: "enabled",
        budget_tokens: 10000,
      };
    } else {
      // Temperature only applies when extended thinking is disabled
      requestParams.temperature = temperature;
    }

    let retryCount = 0;
    while (retryCount <= this.maxRetries) {
      try {
        const stream = await this.client.messages.stream(requestParams);

        let currentToolCall: Partial<ToolCall> | null = null;
        let toolCallInputJson = "";

        for await (const event of stream) {
          // Handle different event types
          if (event.type === "content_block_start") {
            const block = event.content_block as any;

            // Extended thinking block started (beta feature)
            if (block.type === "thinking") {
              yield {
                type: "thinking",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                content: "",
              };
            } else if (block.type === "tool_use") {
              // Tool call started
              currentToolCall = {
                id: block.id,
                name: block.name,
                arguments: {},
              };
              toolCallInputJson = "";
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta as any;

            // Extended thinking delta (beta feature)
            if (delta.type === "thinking_delta") {
              yield {
                type: "thinking",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                content: delta.thinking,
              };
            } else if (delta.type === "text_delta") {
              // Streaming text response
              yield {
                type: "text",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                text: delta.text,
                isDone: false,
              };
            } else if (delta.type === "input_json_delta") {
              // Accumulate tool input JSON
              toolCallInputJson += delta.partial_json;
            }
          } else if (event.type === "content_block_stop") {
            // Content block completed
            if (currentToolCall && currentToolCall.id) {
              // Parse accumulated JSON for tool arguments
              try {
                currentToolCall.arguments = toolCallInputJson
                  ? JSON.parse(toolCallInputJson)
                  : {};
              } catch {
                currentToolCall.arguments = {};
              }

              yield {
                type: "tool_call",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                toolCall: currentToolCall as ToolCall,
              };

              currentToolCall = null;
              toolCallInputJson = "";
            }
          } else if (event.type === "message_stop") {
            // Message completed - signal text is done
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

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || retryCount > this.maxRetries) {
          // Not retryable or exhausted retries
          yield {
            type: "error",
            chunkId: uuidv4(),
            timestamp: Date.now(),
            error: {
              code: this.getErrorCode(error),
              message:
                error instanceof Error ? error.message : "Unknown Claude API error",
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
    config: ClaudeRequestConfig,
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
      isError?: boolean;
    }>
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    // Build messages with tool results
    const updatedMessages: Anthropic.MessageParam[] = [
      ...this.formatMessagesForClaude(messages),
      {
        role: "user",
        content: toolResults.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.toolCallId,
          content: JSON.stringify(tr.result),
          is_error: tr.isError,
        })),
      },
    ];

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      system: this.buildSystemContent(systemPrompt, tools),
      messages: updatedMessages,
      tools: this.formatToolsForClaude(tools),
    };

    try {
      const stream = await this.client.messages.stream(requestParams);

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;

          if (delta.type === "text_delta") {
            yield {
              type: "text",
              chunkId: uuidv4(),
              timestamp: Date.now(),
              text: delta.text,
              isDone: false,
            };
          }
        } else if (event.type === "message_stop") {
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
            error instanceof Error ? error.message : "Unknown Claude API error",
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) {
      // Retry on rate limits, server errors, and timeout
      return (
        error.status === 429 || // Rate limit
        error.status === 500 || // Server error
        error.status === 502 || // Bad gateway
        error.status === 503 || // Service unavailable
        error.status === 504 // Gateway timeout
      );
    }

    // Network errors are retryable
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
    if (error instanceof Anthropic.APIError) {
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
      // Make a minimal API call to test connectivity
      await this.client.messages.create({
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
 * Create a Claude provider instance
 */
export function createClaudeProvider(apiKey?: string): ClaudeProvider {
  return new ClaudeProvider(apiKey);
}

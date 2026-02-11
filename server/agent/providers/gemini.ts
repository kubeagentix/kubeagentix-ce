import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  FunctionDeclarationSchemaType,
} from "@google/generative-ai";
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
 * Gemini function declaration format
 */
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: FunctionDeclarationSchemaType;
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Request configuration for Gemini API calls
 */
interface GeminiRequestConfig {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  modelPreferences?: ModelPreferences;
}

/**
 * Gemini Provider implementing LLMProvider interface
 *
 * Features:
 * - Streaming responses via AsyncGenerator
 * - 1M context window (cost-effective for large contexts)
 * - Function calling for tools
 * - Error handling with retries
 */
export class GeminiProvider implements LLMProvider {
  id = "gemini";
  name = "Gemini (Google)";

  supportedModels = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.0-flash",
  ];
  defaultModel = "gemini-2.5-flash";
  contextWindowSize = 1000000; // 1M tokens
  supportsStreaming = true;
  supportsToolUse = true;
  supportsVision = true;
  supportsExtendedThinking = false;

  costPer1kInputTokens = 0.00025; // Very cost-effective
  costPer1kOutputTokens = 0.0005;

  apiKeyRequired = true;
  priority = 3;

  private client: GoogleGenerativeAI;
  private maxRetries = 3;
  private retryDelayMs = 1000;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new AgentError(
        "MISSING_API_KEY",
        "GOOGLE_API_KEY is required for Gemini provider",
        false
      );
    }
    this.client = new GoogleGenerativeAI(key);
  }

  /**
   * Convert internal tool definitions to Gemini's function format
   */
  private formatToolsForGemini(
    tools: ToolDefinition[]
  ): GeminiFunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: this.convertPropertiesToGeminiFormat(
          tool.parameters.properties
        ),
        required: tool.parameters.required,
      },
    }));
  }

  /**
   * Convert property types to Gemini-compatible format
   */
  private convertPropertiesToGeminiFormat(
    properties: Record<string, any>
  ): Record<string, any> {
    const converted: Record<string, any> = {};

    for (const [key, value] of Object.entries(properties)) {
      converted[key] = {
        type: this.mapTypeToGemini(value.type),
        description: value.description,
      };

      if (value.enum) {
        converted[key].enum = value.enum;
      }
    }

    return converted;
  }

  /**
   * Map types to Gemini-compatible types
   */
  private mapTypeToGemini(type: string): string {
    const typeMap: Record<string, string> = {
      string: "string",
      number: "number",
      integer: "integer",
      boolean: "boolean",
      object: "object",
      array: "array",
    };
    return typeMap[type] || "string";
  }

  /**
   * Convert internal messages to Gemini's Content format
   */
  private formatMessagesForGemini(messages: AgentMessage[]): Content[] {
    return messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));
  }

  /**
   * Get generative model with configuration
   */
  private getModel(
    modelName: string,
    systemPrompt: string,
    tools: ToolDefinition[],
    temperature: number,
    maxTokens: number
  ): GenerativeModel {
    const functionDeclarations = this.formatToolsForGemini(tools);

    return this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
      tools: [{ functionDeclarations }],
    });
  }

  /**
   * Stream response chunks from Gemini API
   */
  async *streamResponse(
    config: GeminiRequestConfig
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;

    let retryCount = 0;
    while (retryCount <= this.maxRetries) {
      try {
        const genModel = this.getModel(
          model,
          systemPrompt,
          tools,
          temperature,
          maxTokens
        );

        const history = this.formatMessagesForGemini(messages.slice(0, -1));
        const lastMessage = messages[messages.length - 1];

        const chat = genModel.startChat({
          history,
        });

        const result = await chat.sendMessageStream(lastMessage.content);

        for await (const chunk of result.stream) {
          const candidates = chunk.candidates;
          if (!candidates || candidates.length === 0) continue;

          const content = candidates[0].content;
          if (!content || !content.parts) continue;

          for (const part of content.parts) {
            // Handle text content
            if ("text" in part && part.text) {
              yield {
                type: "text",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                text: part.text,
                isDone: false,
              };
            }

            // Handle function calls
            if ("functionCall" in part && part.functionCall) {
              const fc = part.functionCall;
              yield {
                type: "tool_call",
                chunkId: uuidv4(),
                timestamp: Date.now(),
                toolCall: {
                  id: uuidv4(), // Gemini doesn't provide an ID
                  name: fc.name,
                  arguments: (fc.args as Record<string, any>) || {},
                } as ToolCall,
              };
            }
          }

          // Check for finish reason
          const finishReason = candidates[0].finishReason;
          if (finishReason === "STOP") {
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
                error instanceof Error ? error.message : "Unknown Gemini API error",
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
    config: GeminiRequestConfig,
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
      isError?: boolean;
    }>
  ): AsyncGenerator<AgentResponseChunk> {
    const { systemPrompt, messages, tools, modelPreferences } = config;

    const model = modelPreferences?.model || this.defaultModel;
    const maxTokens = modelPreferences?.maxTokens || 4096;
    const temperature = modelPreferences?.temperature ?? 0.7;

    try {
      const genModel = this.getModel(
        model,
        systemPrompt,
        tools,
        temperature,
        maxTokens
      );

      // Build history with function call and responses
      const history = this.formatMessagesForGemini(messages);

      // Add function response parts
      const functionResponses = toolResults.map((tr) => ({
        functionResponse: {
          name: tr.toolName,
          response: tr.result,
        },
      }));

      const chat = genModel.startChat({
        history: [
          ...history,
          {
            role: "model",
            parts: toolResults.map((tr) => ({
              functionCall: {
                name: tr.toolName,
                args: {},
              },
            })),
          },
          {
            role: "function",
            parts: functionResponses,
          },
        ],
      });

      // Send empty message to get synthesis
      const result = await chat.sendMessageStream(
        "Please synthesize the tool results and provide your analysis."
      );

      for await (const chunk of result.stream) {
        const candidates = chunk.candidates;
        if (!candidates || candidates.length === 0) continue;

        const content = candidates[0].content;
        if (!content || !content.parts) continue;

        for (const part of content.parts) {
          if ("text" in part && part.text) {
            yield {
              type: "text",
              chunkId: uuidv4(),
              timestamp: Date.now(),
              text: part.text,
              isDone: false,
            };
          }
        }

        if (candidates[0].finishReason === "STOP") {
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
            error instanceof Error ? error.message : "Unknown Gemini API error",
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Retryable conditions
      return (
        message.includes("rate limit") ||
        message.includes("quota") ||
        message.includes("503") ||
        message.includes("500") ||
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("econnreset")
      );
    }

    return false;
  }

  /**
   * Get error code from error
   */
  private getErrorCode(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("unauthorized") || message.includes("401")) {
        return "UNAUTHORIZED";
      }
      if (message.includes("forbidden") || message.includes("403")) {
        return "FORBIDDEN";
      }
      if (message.includes("not found") || message.includes("404")) {
        return "NOT_FOUND";
      }
      if (
        message.includes("rate limit") ||
        message.includes("quota") ||
        message.includes("429")
      ) {
        return "RATE_LIMITED";
      }
      if (message.includes("500") || message.includes("503")) {
        return "SERVER_ERROR";
      }
      if (message.includes("timeout")) {
        return "TIMEOUT";
      }
      if (message.includes("network")) {
        return "NETWORK_ERROR";
      }
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
      const model = this.client.getGenerativeModel({ model: this.defaultModel });
      await model.generateContent("Hi");
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Gemini provider instance
 */
export function createGeminiProvider(apiKey?: string): GeminiProvider {
  return new GeminiProvider(apiKey);
}

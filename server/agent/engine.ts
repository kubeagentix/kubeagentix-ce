import {
  AgentRequest,
  AgentResponseChunk,
  AgentMessage,
  ToolDefinition,
  ToolHandler,
  LLMProvider,
  ToolCall,
  ToolResult,
  AgentError,
  ModelPreferences,
} from "@shared/coordination";
import { v4 as uuidv4 } from "uuid";
import {
  ClaudeProvider,
  OpenAIProvider,
  GeminiProvider,
  createConfiguredProviders,
} from "./providers";

/**
 * Extended provider interface with streaming methods
 */
interface StreamingProvider extends LLMProvider {
  streamResponse(config: {
    systemPrompt: string;
    messages: AgentMessage[];
    tools: ToolDefinition[];
    modelPreferences?: ModelPreferences;
  }): AsyncGenerator<AgentResponseChunk>;

  continueWithToolResults?(
    config: {
      systemPrompt: string;
      messages: AgentMessage[];
      tools: ToolDefinition[];
      modelPreferences?: ModelPreferences;
    },
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
      isError?: boolean;
    }>
  ): AsyncGenerator<AgentResponseChunk>;
}

/**
 * Main agent engine for orchestrating LLM calls and tool execution
 * Manages conversation state, tool registry, and LLM provider selection
 */
export class AgentEngine {
  private tools = new Map<
    string,
    { definition: ToolDefinition; handler: ToolHandler }
  >();
  private providers = new Map<string, StreamingProvider>();
  private conversationHistory = new Map<string, AgentMessage[]>();
  private initialized = false;

  constructor() {
    // Initialize will be called after providers are registered
  }

  /**
   * Initialize providers from environment configuration
   */
  initialize(): void {
    if (this.initialized) return;

    // Create providers from environment variables
    const configuredProviders = createConfiguredProviders();
    for (const [id, provider] of configuredProviders) {
      this.providers.set(id, provider as StreamingProvider);
    }

    this.initialized = true;
    console.log(
      `AgentEngine initialized with providers: ${Array.from(this.providers.keys()).join(", ") || "none"}`
    );
  }

  /**
   * Register an LLM provider
   */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider as StreamingProvider);
  }

  /**
   * Register a tool with its definition and handler
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Get available tools for a user
   */
  getAvailableTools(userId: string): ToolDefinition[] {
    // TODO: Implement RBAC to filter tools per user
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Select best LLM provider based on request characteristics
   */
  selectProvider(request: AgentRequest): StreamingProvider {
    // Ensure providers are initialized
    if (!this.initialized) {
      this.initialize();
    }
    // If user has preference, use it
    if (request.modelPreferences?.providerId) {
      const provider = this.providers.get(request.modelPreferences.providerId);
      if (provider) return provider;
    }

    // Intelligent selection based on request characteristics
    const toolNames = request.toolPreferences?.selectedTools || [];
    const requiresExtendedThinking =
      request.modelPreferences?.useExtendedThinking === true;
    const contextSize = this.estimateContextSize(request);

    // High-capability model defaults for complex reasoning and larger context
    if (
      requiresExtendedThinking ||
      contextSize > 50000 ||
      toolNames.length > 5
    ) {
      const claude = this.providers.get("claude");
      if (claude) return claude;
    }

    // Gemini for fast, cost-effective responses
    if (contextSize < 10000 && toolNames.length < 3) {
      const gemini = this.providers.get("gemini");
      if (gemini) return gemini;
    }

    // OpenAI as reliable fallback
    const openai = this.providers.get("openai");
    if (openai) return openai;

    // Use first available provider
    const providers = Array.from(this.providers.values());
    if (providers.length === 0) {
      throw new AgentError("NO_PROVIDER", "No LLM providers configured", false);
    }
    return providers[0];
  }

  /**
   * Process a request and return async generator of response chunks
   */
  async *processRequest(
    request: AgentRequest,
  ): AsyncGenerator<AgentResponseChunk> {
    try {
      // Validate request
      this.validateRequest(request);

      // Get or create conversation history
      let history = this.conversationHistory.get(request.conversationId) || [];
      history = [...history, ...request.messages];

      // Select provider and tools
      const provider = this.selectProvider(request);
      const availableTools = this.filterTools(request);

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(availableTools);

      // Call LLM with streaming
      const llmRequest = {
        systemPrompt,
        messages: history,
        tools: availableTools,
        modelPreferences: request.modelPreferences,
      };

      // Stream LLM response
      let responseContent = "";
      let toolCalls: ToolCall[] = [];

      for await (const chunk of this.callLLM(provider, llmRequest)) {
        yield chunk;

        // Extract tool calls and text
        if (chunk.type === "text" && chunk.text) {
          responseContent += chunk.text;
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        }
      }

      // Execute tools if called
      if (toolCalls.length > 0) {
        const maxToolCalls = Math.max(
          1,
          request.toolPreferences?.maxToolCalls ?? 5,
        );
        const executableToolCalls = toolCalls.slice(0, maxToolCalls);

        if (toolCalls.length > executableToolCalls.length) {
          yield {
            type: "text",
            chunkId: uuidv4(),
            timestamp: Date.now(),
            text: `Tool call limit reached (${maxToolCalls}). Continuing with the first ${maxToolCalls} calls.`,
            isDone: false,
          };
        }

        const toolResults = await this.executeTools(
          executableToolCalls,
          request.context,
        );

        // Send results back to LLM for synthesis
        for await (const chunk of this.synthesizeResponse(
          provider,
          history,
          toolResults,
          availableTools,
          request.modelPreferences,
        )) {
          yield chunk;
          if (chunk.type === "text" && chunk.text) {
            responseContent += chunk.text;
          }
        }
      }

      // Save conversation
      history.push({
        role: "assistant",
        content: responseContent,
        timestamp: Date.now(),
      });
      this.conversationHistory.set(request.conversationId, history);

      // Send completion chunk
      yield {
        type: "complete",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        summary: {
          toolCallCount: toolCalls.length,
          executionTimeMs: 0, // TODO: Track timing
        },
      };
    } catch (error) {
      const agentError =
        error instanceof AgentError
          ? error
          : new AgentError(
              "UNKNOWN_ERROR",
              error instanceof Error ? error.message : "Unknown error",
              true,
            );

      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: agentError.code,
          message: agentError.message,
          retryable: agentError.retryable,
        },
      };
    }
  }

  /**
   * Call LLM and stream response chunks using the provider's streamResponse method
   */
  private async *callLLM(
    provider: StreamingProvider,
    request: {
      systemPrompt: string;
      messages: AgentMessage[];
      tools: ToolDefinition[];
      modelPreferences?: ModelPreferences;
    },
  ): AsyncGenerator<AgentResponseChunk> {
    // Use the provider's streamResponse method directly
    yield* provider.streamResponse(request);
  }

  /**
   * Synthesize response after tool execution
   */
  private async *synthesizeResponse(
    provider: StreamingProvider,
    history: AgentMessage[],
    toolResults: ToolResult[],
    tools: ToolDefinition[],
    modelPreferences?: ModelPreferences,
  ): AsyncGenerator<AgentResponseChunk> {
    // First, yield tool results to the client
    for (const result of toolResults) {
      yield {
        type: "tool_result",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        toolResult: result,
      };
    }

    // If provider supports continueWithToolResults, use it
    if (provider.continueWithToolResults) {
      const systemPrompt = this.buildSystemPrompt(tools);
      const formattedResults = toolResults.map((r) => ({
        toolCallId: r.callId,
        toolName: r.toolName,
        result: r.success ? r.result : { error: r.error },
        isError: !r.success,
      }));

      yield* provider.continueWithToolResults(
        {
          systemPrompt,
          messages: history,
          tools,
          modelPreferences,
        },
        formattedResults
      );
    } else {
      // Fallback: Add tool results to messages and make another call
      const systemPrompt = this.buildSystemPrompt(tools);
      const toolResultsText = toolResults
        .map(
          (r) =>
            `Tool ${r.toolName}: ${r.success ? JSON.stringify(r.result) : `Error: ${r.error}`}`
        )
        .join("\n");

      const updatedHistory: AgentMessage[] = [
        ...history,
        {
          role: "user",
          content: `Tool results:\n${toolResultsText}\n\nPlease analyze these results and provide your response.`,
          timestamp: Date.now(),
        },
      ];

      yield* provider.streamResponse({
        systemPrompt,
        messages: updatedHistory,
        tools,
        modelPreferences,
      });
    }
  }

  /**
   * Execute registered tools
   */
  private async executeTools(
    toolCalls: ToolCall[],
    context: any,
  ): Promise<any[]> {
    const results: any[] = [];

    // Execute tools in parallel
    const promises = toolCalls.map(async (toolCall) => {
      const tool = this.tools.get(toolCall.name);
      if (!tool) {
        return {
          callId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          error: `Tool ${toolCall.name} not found`,
        };
      }

      try {
        const startTime = Date.now();
        const result = await tool.handler(toolCall.arguments, context);
        const executionTimeMs = Date.now() - startTime;

        return {
          callId: toolCall.id,
          toolName: toolCall.name,
          success: true,
          result,
          executionTimeMs,
        };
      } catch (error) {
        return {
          callId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    results.push(...(await Promise.all(promises)));
    return results;
  }

  /**
   * Filter tools based on user preferences and permissions
   */
  private filterTools(request: AgentRequest): ToolDefinition[] {
    let available = Array.from(this.tools.values()).map((t) => t.definition);

    // Apply tool preferences
    if (request.toolPreferences?.selectedTools) {
      available = available.filter((t) =>
        request.toolPreferences?.selectedTools?.includes(t.name),
      );
    }

    if (request.toolPreferences?.excludedTools) {
      available = available.filter(
        (t) => !request.toolPreferences?.excludedTools?.includes(t.name),
      );
    }

    return available;
  }

  /**
   * Build system prompt for the LLM
   */
  private buildSystemPrompt(tools: ToolDefinition[]): string {
    return `You are an expert Kubernetes operations assistant. Your role is to help diagnose and resolve Kubernetes cluster issues.

You have access to the following tools:

${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")}

When investigating an issue:
1. Gather facts by calling multiple tools in parallel when possible
2. Analyze the evidence systematically
3. Form hypotheses and test them with targeted tool calls
4. Provide clear diagnosis and recommended actions
5. Never execute dangerous operations without explicit user confirmation
6. For namespace discovery use namespace-focused tools, and for cross-namespace checks set namespace to "all"

Always prioritize safety and clarity.`;
  }

  /**
   * Estimate context size for provider selection
   */
  private estimateContextSize(request: AgentRequest): number {
    // Rough estimation: ~4 bytes per token
    let size = 0;

    // Count message tokens
    request.messages.forEach((msg) => {
      size += msg.content.length / 4;
    });

    // Add context overhead
    size += 500; // Cluster info, etc.

    return size;
  }

  /**
   * Validate incoming request
   */
  private validateRequest(request: AgentRequest): void {
    if (!request.conversationId) {
      throw new AgentError("INVALID_REQUEST", "Missing conversationId", false);
    }

    if (!request.messages || request.messages.length === 0) {
      throw new AgentError("INVALID_REQUEST", "No messages provided", false);
    }

    if (!request.context?.cluster) {
      throw new AgentError(
        "INVALID_REQUEST",
        "Missing cluster in context",
        false,
      );
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory(conversationId: string): AgentMessage[] {
    return this.conversationHistory.get(conversationId) || [];
  }

  /**
   * Save conversation to persistent storage
   */
  async saveConversation(
    conversationId: string,
    messages: AgentMessage[],
  ): Promise<void> {
    // TODO: Implement database storage
    // Save to PostgreSQL for server instances
    // Save to SQLite for desktop instances
    this.conversationHistory.set(conversationId, messages);
  }

  /**
   * Clear conversation history
   */
  clearConversationHistory(conversationId: string): void {
    this.conversationHistory.delete(conversationId);
  }
}

// Singleton instance
let agentEngine: AgentEngine | null = null;

/**
 * Get or create the agent engine singleton
 * Automatically initializes providers from environment
 */
export function getAgentEngine(): AgentEngine {
  if (!agentEngine) {
    agentEngine = new AgentEngine();
    agentEngine.initialize();
  }
  return agentEngine;
}

/**
 * Reset the agent engine (useful for testing)
 */
export function resetAgentEngine(): void {
  agentEngine = null;
}

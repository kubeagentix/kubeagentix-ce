import { RequestHandler } from "express";
import { AgentRequest, AgentResponseChunk } from "@shared/coordination";
import { getAgentEngine } from "../agent/engine";
import { getAllToolDefinitions, getToolHandler } from "../agent/tools";

/**
 * Handler for POST /api/agent/invoke
 * Processes agent requests and streams responses
 */
export const handleAgentInvoke: RequestHandler = async (req, res) => {
  try {
    const request = req.body as AgentRequest;

    // Validate request
    if (!request.conversationId) {
      return res.status(400).json({
        error: "Missing conversationId",
        code: "INVALID_REQUEST",
      });
    }

    if (!request.messages || request.messages.length === 0) {
      return res.status(400).json({
        error: "No messages provided",
        code: "INVALID_REQUEST",
      });
    }

    if (!request.context?.cluster) {
      if (request.context?.clusterContext) {
        request.context.cluster = request.context.clusterContext;
      }
    }

    if (!request.context?.cluster) {
      return res.status(400).json({
        error: "Missing cluster in context",
        code: "INVALID_REQUEST",
      });
    }

    // Set up streaming response
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Get agent engine
    const engine = getAgentEngine();

    // Register tools (would normally be done at startup)
    const tools = getAllToolDefinitions();
    tools.forEach((toolDef) => {
      const handler = getToolHandler(toolDef.name);
      if (handler) {
        engine.registerTool(toolDef, handler);
      }
    });

    // Process request and stream response
    for await (const chunk of engine.processRequest(request)) {
      // Send each chunk as JSON line
      res.write(JSON.stringify(chunk) + "\n");
    }

    // End response
    res.write("\n");
    res.end();
  } catch (error) {
    console.error("Agent invoke error:", error);

    // Send error as JSON line if response hasn't been sent
    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
        code: "AGENT_ERROR",
      });
    } else {
      // If headers were sent, send error as final chunk
      const errorChunk: AgentResponseChunk = {
        type: "error",
        chunkId: "error",
        timestamp: Date.now(),
        error: {
          code: "AGENT_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
          retryable: true,
        },
      };
      res.write(JSON.stringify(errorChunk) + "\n");
      res.end();
    }
  }
};

/**
 * Handler for GET /api/agent/tools
 * Returns available tools for a user
 */
export const handleGetTools: RequestHandler = (req, res) => {
  try {
    const tools = getAllToolDefinitions();

    // TODO: Filter tools based on user permissions
    const userId = ((req as any).user as any)?.id || "anonymous";

    res.json({
      tools,
      count: tools.length,
      userId,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      code: "GET_TOOLS_ERROR",
    });
  }
};

/**
 * Handler for GET /api/agent/conversations/:conversationId
 * Retrieves conversation history
 */
export const handleGetConversation: RequestHandler = (req, res) => {
  try {
    const { conversationId } = req.params;

    const engine = getAgentEngine();
    const messages = engine.getConversationHistory(conversationId);

    res.json({
      conversationId,
      messages,
      messageCount: messages.length,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      code: "GET_CONVERSATION_ERROR",
    });
  }
};

/**
 * Handler for DELETE /api/agent/conversations/:conversationId
 * Clears conversation history
 */
export const handleClearConversation: RequestHandler = (req, res) => {
  try {
    const { conversationId } = req.params;

    const engine = getAgentEngine();
    engine.clearConversationHistory(conversationId);

    res.json({
      conversationId,
      cleared: true,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      code: "CLEAR_CONVERSATION_ERROR",
    });
  }
};

/**
 * Handler for POST /api/agent/test-provider
 * Tests LLM provider connectivity
 */
export const handleTestProvider: RequestHandler = async (req, res) => {
  try {
    const { providerId, apiKey, model } = req.body;

    if (!providerId || !apiKey) {
      return res.status(400).json({
        error: "Missing providerId or apiKey",
        code: "INVALID_REQUEST",
      });
    }

    const engine = getAgentEngine();

    // Create a temporary provider to test with the provided API key
    let testProvider;
    try {
      const { createProvider } = await import("../agent/providers");
      testProvider = createProvider(providerId, apiKey);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid provider ID",
        code: "INVALID_PROVIDER",
      });
    }

    // Test the provider by making a simple streaming request
    const testRequest = {
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user" as const,
          content: "Say 'Connection successful!' and nothing else.",
        },
      ],
      tools: [],
      modelPreferences: model ? { model } : undefined,
    };

    let hasResponse = false;
    let errorOccurred = false;
    let errorMessage = "";

    try {
      // Try to get at least one response chunk from the provider
      if (
        "streamResponse" in testProvider &&
        typeof testProvider.streamResponse === "function"
      ) {
        const generator = testProvider.streamResponse(testRequest);
        const { value } = await generator.next();

        if (value) {
          hasResponse = true;
        }
      }
    } catch (streamError) {
      errorOccurred = true;
      errorMessage =
        streamError instanceof Error ? streamError.message : "Unknown error";
    }

    if (errorOccurred || !hasResponse) {
      return res.status(500).json({
        status: "error",
        message: errorMessage || "Provider did not respond",
        providerId,
        code: "PROVIDER_TEST_FAILED",
      });
    }

    res.json({
      status: "success",
      providerId,
      message: "Provider connection successful",
      model: model || "default",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      code: "PROVIDER_TEST_ERROR",
    });
  }
};

import { describe, expect, it, vi } from "vitest";
import { AgentEngine } from "../engine";
import { AgentRequest, ToolDefinition } from "@shared/coordination";

describe("AgentEngine", () => {
  it("does not reduce available tools based on maxToolCalls preference", async () => {
    const engine = new AgentEngine();
    let observedToolCount = 0;

    const mockProvider: any = {
      id: "mock",
      name: "Mock Provider",
      supportedModels: ["mock-model"],
      defaultModel: "mock-model",
      contextWindowSize: 8000,
      supportsStreaming: true,
      supportsToolUse: true,
      supportsVision: false,
      supportsExtendedThinking: false,
      costPer1kInputTokens: 0,
      costPer1kOutputTokens: 0,
      apiKeyRequired: false,
      priority: 1,
      async *streamResponse(config: { tools: ToolDefinition[] }) {
        observedToolCount = config.tools.length;
        yield {
          type: "text",
          chunkId: "chunk-1",
          timestamp: Date.now(),
          text: "ok",
          isDone: true,
        };
      },
    };

    engine.registerProvider(mockProvider);

    const definitions: ToolDefinition[] = Array.from({ length: 6 }, (_, i) => ({
      name: `tool_${i + 1}`,
      description: `Tool ${i + 1}`,
      category: "custom",
      parameters: {
        type: "object",
        properties: {},
        required: [] as string[],
      },
    }));

    definitions.forEach((definition) => {
      engine.registerTool(definition, async () => ({ ok: true }));
    });

    const request: AgentRequest = {
      conversationId: "conv-test",
      userId: "user-test",
      messages: [
        {
          role: "user",
          content: "Hello",
          timestamp: Date.now(),
        },
      ],
      context: {
        cluster: "test-cluster",
        namespace: "default",
      },
      toolPreferences: {
        maxToolCalls: 1,
      },
      modelPreferences: {
        providerId: "mock",
      },
    };

    for await (const _chunk of engine.processRequest(request)) {
      // drain stream
    }

    expect(observedToolCount).toBe(6);
  });

  it("does not provide tools to providers that do not support tool use", async () => {
    const engine = new AgentEngine();
    let observedToolCount = -1;
    let observedSystemPrompt = "";

    const mockProvider: any = {
      id: "mock-no-tools",
      name: "Mock No-Tools Provider",
      supportedModels: ["mock-model"],
      defaultModel: "mock-model",
      contextWindowSize: 8000,
      supportsStreaming: true,
      supportsToolUse: false,
      supportsVision: false,
      supportsExtendedThinking: false,
      costPer1kInputTokens: 0,
      costPer1kOutputTokens: 0,
      apiKeyRequired: false,
      priority: 1,
      async *streamResponse(config: { tools: ToolDefinition[]; systemPrompt: string }) {
        observedToolCount = config.tools.length;
        observedSystemPrompt = config.systemPrompt;
        yield {
          type: "text",
          chunkId: "chunk-1",
          timestamp: Date.now(),
          text: "ok",
          isDone: true,
        };
      },
    };

    engine.registerProvider(mockProvider);
    engine.registerTool(
      {
        name: "list_namespaces",
        description: "List namespaces",
        category: "k8s",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async () => ({ namespaces: [] }),
    );

    const request: AgentRequest = {
      conversationId: "conv-test-no-tools",
      userId: "user-test",
      messages: [
        {
          role: "user",
          content: "What namespaces are available?",
          timestamp: Date.now(),
        },
      ],
      context: {
        cluster: "test-cluster",
        namespace: "default",
      },
      modelPreferences: {
        providerId: "mock-no-tools",
      },
    };

    for await (const _chunk of engine.processRequest(request)) {
      // drain stream
    }

    expect(observedToolCount).toBe(0);
    expect(observedSystemPrompt).toContain("no executable tools are available");
  });

  it("parses claude_code compatibility function_calls markup and executes tools", async () => {
    const engine = new AgentEngine();
    const chunks: any[] = [];
    let invocationCount = 0;

    const mockProvider: any = {
      id: "claude_code_compat",
      name: "Claude Code (Compatibility)",
      supportedModels: ["sonnet"],
      defaultModel: "sonnet",
      contextWindowSize: 200000,
      supportsStreaming: true,
      supportsToolUse: false,
      supportsVision: false,
      supportsExtendedThinking: false,
      costPer1kInputTokens: 0,
      costPer1kOutputTokens: 0,
      apiKeyRequired: false,
      priority: 1,
      async *streamResponse(config: any) {
        invocationCount += 1;
        if (invocationCount === 1) {
          yield {
            type: "text",
            chunkId: "chunk-compat-1",
            timestamp: Date.now(),
            text: `<function_calls>\n<invoke name="list_namespaces">\n</invoke>\n</function_calls>`,
            isDone: true,
          };
          return;
        }

        const lastMessage = config.messages[config.messages.length - 1]?.content || "";
        yield {
          type: "text",
          chunkId: "chunk-compat-2",
          timestamp: Date.now(),
          text: lastMessage.includes("Tool results:") ? "Namespaces fetched." : "Done.",
          isDone: true,
        };
      },
    };

    engine.registerProvider(mockProvider);
    engine.registerTool(
      {
        name: "list_namespaces",
        description: "List namespaces",
        category: "k8s",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async () => ({ namespaces: ["default", "kube-system"] }),
    );

    const request: AgentRequest = {
      conversationId: "conv-compat-tools",
      userId: "user-test",
      messages: [
        {
          role: "user",
          content: "Which namespaces can I access?",
          timestamp: Date.now(),
        },
      ],
      context: {
        cluster: "test-cluster",
        namespace: "default",
      },
      modelPreferences: {
        providerId: "claude_code_compat",
      },
    };

    for await (const chunk of engine.processRequest(request)) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === "tool_call")).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "tool_result")).toBe(true);
    expect(
      chunks.some(
        (chunk) => chunk.type === "text" && String(chunk.text || "").includes("Namespaces fetched."),
      ),
    ).toBe(true);
  });
});

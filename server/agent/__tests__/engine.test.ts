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
});

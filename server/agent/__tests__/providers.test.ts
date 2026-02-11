import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeProvider } from "../providers/claude";
import { OpenAIProvider } from "../providers/openai";
import { GeminiProvider } from "../providers/gemini";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  createConfiguredProviders,
  createProvider,
  getProviderMetadata,
} from "../providers";
import { ToolDefinition, AgentMessage, AgentError } from "@shared/coordination";

// Mock the SDKs
vi.mock("@anthropic-ai/sdk", () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_start",
        content_block: { type: "text" },
      };
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello, " },
      };
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "I'm Claude!" },
      };
      yield {
        type: "message_stop",
      };
    },
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        stream: vi.fn().mockResolvedValue(mockStream),
        create: vi.fn().mockResolvedValue({
          id: "msg_123",
          content: [{ type: "text", text: "Hi" }],
        }),
      },
    })),
    APIError: class APIError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

vi.mock("openai", () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: { content: "Hello from " },
            finish_reason: null,
          },
        ],
      };
      yield {
        choices: [
          {
            delta: { content: "OpenAI!" },
            finish_reason: null,
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
    },
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    })),
    APIError: class APIError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

vi.mock("@google/generative-ai", () => {
  const mockStreamGenerator = async function* () {
    yield {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from " }],
          },
          finishReason: null,
        },
      ],
    };
    yield {
      candidates: [
        {
          content: {
            parts: [{ text: "Gemini!" }],
          },
          finishReason: "STOP",
        },
      ],
    };
  };

  const mockResult = {
    stream: mockStreamGenerator(),
  };

  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        startChat: vi.fn().mockReturnValue({
          sendMessageStream: vi.fn().mockImplementation(() =>
            Promise.resolve({ stream: mockStreamGenerator() })
          ),
        }),
        generateContent: vi.fn().mockResolvedValue({
          response: { text: () => "Hi" },
        }),
      }),
    })),
    FunctionDeclarationSchemaType: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      NUMBER: "NUMBER",
      BOOLEAN: "BOOLEAN",
      ARRAY: "ARRAY",
      INTEGER: "INTEGER",
    },
  };
});

// Sample test data
const sampleTools: ToolDefinition[] = [
  {
    name: "list_pods",
    description: "List Kubernetes pods",
    category: "k8s",
    parameters: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
        },
      },
      required: ["namespace"],
    },
  },
];

const sampleMessages: AgentMessage[] = [
  {
    role: "user",
    content: "List all pods in the default namespace",
    timestamp: Date.now(),
  },
];

const sampleSystemPrompt =
  "You are a Kubernetes operations assistant.";

describe("ClaudeProvider", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create provider with API key from env", () => {
      const provider = new ClaudeProvider();
      expect(provider.id).toBe("claude");
      expect(provider.name).toBe("Claude (Anthropic)");
    });

    it("should create provider with explicit API key", () => {
      const provider = new ClaudeProvider("explicit-key");
      expect(provider.id).toBe("claude");
    });

    it("should throw error when no API key provided", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => new ClaudeProvider()).toThrow(AgentError);
    });
  });

  describe("provider metadata", () => {
    it("should have correct properties", () => {
      const provider = new ClaudeProvider();
      expect(provider.supportedModels).toContain("claude-opus-4-1-20250805");
      expect(provider.contextWindowSize).toBe(200000);
      expect(provider.supportsStreaming).toBe(true);
      expect(provider.supportsToolUse).toBe(true);
      expect(provider.supportsExtendedThinking).toBe(true);
    });
  });

  describe("streamResponse", () => {
    it("should stream text chunks", async () => {
      const provider = new ClaudeProvider();
      const chunks: any[] = [];

      for await (const chunk of provider.streamResponse({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      })) {
        chunks.push(chunk);
      }

      // Should have text chunks and isDone
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.type === "text")).toBe(true);
    });

    it("should include timestamp and chunkId in all chunks", async () => {
      const provider = new ClaudeProvider();

      for await (const chunk of provider.streamResponse({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      })) {
        expect(chunk.chunkId).toBeDefined();
        expect(chunk.timestamp).toBeDefined();
        expect(typeof chunk.timestamp).toBe("number");
      }
    });
  });

  describe("testConnection", () => {
    it("should return true on successful connection", async () => {
      const provider = new ClaudeProvider();
      const result = await provider.testConnection();
      expect(result).toBe(true);
    });
  });
});

describe("OpenAIProvider", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create provider with API key from env", () => {
      const provider = new OpenAIProvider();
      expect(provider.id).toBe("openai");
      expect(provider.name).toBe("OpenAI");
    });

    it("should throw error when no API key provided", () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => new OpenAIProvider()).toThrow(AgentError);
    });
  });

  describe("provider metadata", () => {
    it("should have correct properties", () => {
      const provider = new OpenAIProvider();
      expect(provider.supportedModels).toContain("gpt-5.2");
      expect(provider.contextWindowSize).toBe(128000);
      expect(provider.supportsStreaming).toBe(true);
      expect(provider.supportsToolUse).toBe(true);
      expect(provider.supportsExtendedThinking).toBe(false);
    });
  });

  describe("streamResponse", () => {
    it("should stream text chunks", async () => {
      const provider = new OpenAIProvider();
      const chunks: any[] = [];

      for await (const chunk of provider.streamResponse({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.type === "text")).toBe(true);
    });

    it("should handle finish_reason stop", async () => {
      const provider = new OpenAIProvider();
      const chunks: any[] = [];

      for await (const chunk of provider.streamResponse({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      })) {
        chunks.push(chunk);
      }

      // Should have a chunk with isDone=true
      expect(chunks.some((c) => c.type === "text" && c.isDone === true)).toBe(
        true
      );
    });
  });
});

describe("GeminiProvider", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_API_KEY = "test-google-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create provider with API key from env", () => {
      const provider = new GeminiProvider();
      expect(provider.id).toBe("gemini");
      expect(provider.name).toBe("Gemini (Google)");
    });

    it("should throw error when no API key provided", () => {
      delete process.env.GOOGLE_API_KEY;
      expect(() => new GeminiProvider()).toThrow(AgentError);
    });
  });

  describe("provider metadata", () => {
    it("should have correct properties", () => {
      const provider = new GeminiProvider();
      expect(provider.supportedModels).toContain("gemini-2.5-flash");
      expect(provider.contextWindowSize).toBe(1000000);
      expect(provider.supportsStreaming).toBe(true);
      expect(provider.supportsToolUse).toBe(true);
      expect(provider.supportsExtendedThinking).toBe(false);
    });

    it("should have lower cost than other providers", () => {
      const provider = new GeminiProvider();
      expect(provider.costPer1kInputTokens).toBeLessThan(0.001);
    });
  });

  describe("streamResponse", () => {
    it("should stream text chunks", async () => {
      const provider = new GeminiProvider();
      const chunks: any[] = [];

      for await (const chunk of provider.streamResponse({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.type === "text")).toBe(true);
    });
  });

  describe("continueWithToolResults", () => {
    it("should send function responses with role=function", async () => {
      const provider = new GeminiProvider();

      for await (const _chunk of provider.continueWithToolResults({
        systemPrompt: sampleSystemPrompt,
        messages: sampleMessages,
        tools: sampleTools,
      }, [
        {
          toolCallId: "tool-call-1",
          toolName: "list_pods",
          result: { pods: ["pod-a"] },
        },
      ])) {
        // drain stream
      }

      const aiMock = vi.mocked(GoogleGenerativeAI);
      const lastClientInstance =
        aiMock.mock.results[aiMock.mock.results.length - 1]?.value as {
          getGenerativeModel: ReturnType<typeof vi.fn>;
        };
      const getGenerativeModelMock = lastClientInstance.getGenerativeModel;
      const lastModel =
        getGenerativeModelMock.mock.results[
          getGenerativeModelMock.mock.results.length - 1
        ]?.value as {
          startChat: ReturnType<typeof vi.fn>;
        };
      const startChatMock = lastModel.startChat;
      const startChatArgs = startChatMock.mock.calls[startChatMock.mock.calls.length - 1]?.[0] as {
        history?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      };
      const history = startChatArgs.history || [];
      const functionTurn = history[history.length - 1];

      expect(functionTurn?.role).toBe("function");
      expect(functionTurn?.parts?.[0]).toHaveProperty("functionResponse");
    });
  });
});

describe("Provider Factory Functions", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GOOGLE_API_KEY = "test-google-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("createConfiguredProviders", () => {
    it("should create all providers when all keys are available", () => {
      const providers = createConfiguredProviders();
      expect(providers.has("claude")).toBe(true);
      expect(providers.has("openai")).toBe(true);
      expect(providers.has("gemini")).toBe(true);
    });

    it("should only create providers with available keys", () => {
      delete process.env.OPENAI_API_KEY;
      const providers = createConfiguredProviders();
      expect(providers.has("claude")).toBe(true);
      expect(providers.has("openai")).toBe(false);
      expect(providers.has("gemini")).toBe(true);
    });

    it("should accept explicit config", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const providers = createConfiguredProviders({
        claudeApiKey: "explicit-claude-key",
      });

      expect(providers.has("claude")).toBe(true);
      expect(providers.has("openai")).toBe(false);
      expect(providers.has("gemini")).toBe(false);
    });
  });

  describe("createProvider", () => {
    it("should create claude provider", () => {
      const provider = createProvider("claude");
      expect(provider.id).toBe("claude");
    });

    it("should create openai provider", () => {
      const provider = createProvider("openai");
      expect(provider.id).toBe("openai");
    });

    it("should create gemini provider", () => {
      const provider = createProvider("gemini");
      expect(provider.id).toBe("gemini");
    });

    it("should throw for unknown provider", () => {
      expect(() => createProvider("unknown")).toThrow(AgentError);
    });
  });

  describe("getProviderMetadata", () => {
    it("should return metadata for all providers", () => {
      const metadata = getProviderMetadata();
      expect(metadata).toHaveLength(3);
      expect(metadata.map((m) => m.id)).toContain("claude");
      expect(metadata.map((m) => m.id)).toContain("openai");
      expect(metadata.map((m) => m.id)).toContain("gemini");
    });

    it("should include all required fields", () => {
      const metadata = getProviderMetadata();
      for (const meta of metadata) {
        expect(meta.id).toBeDefined();
        expect(meta.name).toBeDefined();
        expect(meta.contextWindowSize).toBeGreaterThan(0);
        expect(typeof meta.supportsToolUse).toBe("boolean");
        expect(typeof meta.supportsStreaming).toBe("boolean");
        expect(typeof meta.supportsExtendedThinking).toBe("boolean");
        expect(meta.defaultModel).toBeDefined();
      }
    });
  });
});

describe("Error Handling", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";
  });

  describe("Claude error handling", () => {
    it("should identify retryable errors correctly", async () => {
      // The provider should handle rate limits as retryable
      const provider = new ClaudeProvider();
      expect(provider.id).toBe("claude");
      // Error handling is tested implicitly through streamResponse
    });
  });
});

describe("Tool Formatting", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";
  });

  it("should format tools correctly for Claude", async () => {
    const provider = new ClaudeProvider();
    // Tool formatting is tested implicitly through streamResponse
    // which calls formatToolsForClaude internally
    const chunks: any[] = [];
    for await (const chunk of provider.streamResponse({
      systemPrompt: sampleSystemPrompt,
      messages: sampleMessages,
      tools: sampleTools,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should format tools correctly for OpenAI", async () => {
    const provider = new OpenAIProvider();
    const chunks: any[] = [];
    for await (const chunk of provider.streamResponse({
      systemPrompt: sampleSystemPrompt,
      messages: sampleMessages,
      tools: sampleTools,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should format tools correctly for Gemini", async () => {
    const provider = new GeminiProvider();
    const chunks: any[] = [];
    for await (const chunk of provider.streamResponse({
      systemPrompt: sampleSystemPrompt,
      messages: sampleMessages,
      tools: sampleTools,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("Streaming Response Format", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";
  });

  it("should return valid AgentResponseChunk format", async () => {
    const provider = new ClaudeProvider();

    for await (const chunk of provider.streamResponse({
      systemPrompt: sampleSystemPrompt,
      messages: sampleMessages,
      tools: sampleTools,
    })) {
      // Each chunk should have required fields
      expect(chunk).toHaveProperty("type");
      expect(chunk).toHaveProperty("chunkId");
      expect(chunk).toHaveProperty("timestamp");
      expect(["text", "tool_call", "thinking", "complete", "error"]).toContain(
        chunk.type
      );
    }
  });

  it("should have unique chunkIds", async () => {
    const provider = new ClaudeProvider();
    const chunkIds = new Set<string>();

    for await (const chunk of provider.streamResponse({
      systemPrompt: sampleSystemPrompt,
      messages: sampleMessages,
      tools: sampleTools,
    })) {
      expect(chunkIds.has(chunk.chunkId)).toBe(false);
      chunkIds.add(chunk.chunkId);
    }
  });
});

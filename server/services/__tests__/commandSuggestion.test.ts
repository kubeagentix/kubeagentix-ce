import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandSuggestionError, suggestCommand } from "../commandSuggestion";
import {
  createConfiguredProviders,
  createProvider,
} from "../../agent/providers";

vi.mock("../../agent/providers", () => ({
  createConfiguredProviders: vi.fn(),
  createProvider: vi.fn(),
}));

function makeMockProvider(responseText: string) {
  return {
    id: "mock",
    name: "Mock",
    supportedModels: ["mock-model"],
    defaultModel: "mock-model",
    contextWindowSize: 8_000,
    supportsStreaming: true,
    supportsToolUse: false,
    supportsVision: false,
    supportsExtendedThinking: false,
    apiKeyRequired: false,
    async *streamResponse() {
      yield {
        type: "text",
        text: responseText,
      };
    },
  };
}

describe("commandSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createProvider).mockImplementation(() => {
      return makeMockProvider(
        JSON.stringify({
          command: "kubectl get namespaces",
          confidence: 93,
          rationale: "Namespace listing intent",
          assumptions: [],
          warnings: [],
        }),
      ) as any;
    });
  });

  it("accepts valid agentic suggestion", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(
      new Map([["claude", makeMockProvider('{"command":"kubectl get namespaces"}') as any]]),
    );

    const result = await suggestCommand({
      query: "Which namespaces can I access?",
      namespace: "default",
    });

    expect(result.source).toBe("agentic");
    expect(result.suggestedCommand).toBe("kubectl get namespaces");
    expect(result.policyDecision.allowed).toBe(true);
  });

  it("falls back when agentic output is blocked by policy", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(
      new Map([
        [
          "claude",
          makeMockProvider(
            '{"command":"kubectl apply -f deployment.yaml","confidence":90}',
          ) as any,
        ],
      ]),
    );

    const result = await suggestCommand({
      query: "Which namespaces can I access?",
      namespace: "default",
    });

    expect(result.source).toBe("heuristic");
    expect(result.suggestedCommand).toBe("kubectl get namespaces");
    expect(result.warnings.join(" ")).toMatch(/blocked by policy/i);
  });

  it("uses heuristic when no provider is configured", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const result = await suggestCommand({
      query: "Show me pods in dev namespace",
      namespace: "default",
    });

    expect(result.source).toBe("heuristic");
    expect(result.suggestedCommand).toBe("kubectl get pods -n dev");
    expect(result.warnings.join(" ")).toMatch(/no llm provider/i);
  });

  it("maps known intents to deterministic safe commands", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const namespaces = await suggestCommand({
      query: "Which namespaces can I access?",
      namespace: "default",
    });
    expect(namespaces.suggestedCommand).toBe("kubectl get namespaces");

    const warningEvents = await suggestCommand({
      query: "Show warning events in default namespace",
      namespace: "default",
    });
    expect(warningEvents.suggestedCommand).toBe(
      "kubectl get events -n default --field-selector type=Warning",
    );

    const nonRunning = await suggestCommand({
      query: "Show non-running pods across all namespaces",
      namespace: "default",
    });
    expect(nonRunning.suggestedCommand).toBe(
      "kubectl get pods -A --field-selector=status.phase!=Running",
    );
  });

  it("uses recent terminal context namespace for 'here' style queries", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const result = await suggestCommand({
      query: "show me pods here",
      namespace: "default",
      recentTerminalContext: [
        { type: "input", content: "$ kubectl get pods -n troubled" },
        { type: "output", content: "..." },
      ],
    });

    expect(result.source).toBe("heuristic");
    expect(result.suggestedCommand).toBe("kubectl get pods -n troubled");
  });

  it("maps mixed pods + deployments intent deterministically", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const namespaced = await suggestCommand({
      query: "show me pods and deployments in dev",
      namespace: "default",
    });
    expect(namespaced.suggestedCommand).toBe("kubectl get pods,deployments -n dev");

    const allNamespaces = await suggestCommand({
      query: "show pods and deployments across all namespaces",
      namespace: "default",
    });
    expect(allNamespaces.suggestedCommand).toBe("kubectl get pods,deployments -A");
  });

  it("handles typo variants and maps deployment intent deterministically", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const result = await suggestCommand({
      query: "lsit all deplyoments ind dev",
      namespace: "default",
    });

    expect(result.source).toBe("heuristic");
    expect(result.suggestedCommand).toBe("kubectl get deployments -n dev");
  });

  it("maps service and node inventory intents", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const services = await suggestCommand({
      query: "show services across all namespaces",
      namespace: "default",
    });
    expect(services.suggestedCommand).toBe("kubectl get services -A");

    const nodes = await suggestCommand({
      query: "list all nodes in the cluster",
      namespace: "default",
    });
    expect(nodes.suggestedCommand).toBe("kubectl get nodes");
  });

  it("distinguishes warning events from all events", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const warningsOnly = await suggestCommand({
      query: "show warning events in dev namespace",
      namespace: "default",
    });
    expect(warningsOnly.suggestedCommand).toBe(
      "kubectl get events -n dev --field-selector type=Warning",
    );

    const allEvents = await suggestCommand({
      query: "show all events in dev namespace",
      namespace: "default",
    });
    expect(allEvents.suggestedCommand).toBe("kubectl get events -n dev");
  });

  it("maps pod logs lookup intent", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    const result = await suggestCommand({
      query: "show logs for worker-545b8f8bf9-n8jb5 in dev",
      namespace: "default",
    });
    expect(result.suggestedCommand).toBe(
      "kubectl logs worker-545b8f8bf9-n8jb5 -n dev --tail 100",
    );
  });

  it("falls back to deterministic non-running pod command when agentic misses intent", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(
      new Map([
        [
          "claude",
          makeMockProvider(
            '{"command":"kubectl get pods -n default","confidence":88}',
          ) as any,
        ],
      ]),
    );

    const result = await suggestCommand({
      query: "show me pods which are not runnig in the cluster",
      namespace: "default",
    });

    expect(result.source).toBe("heuristic");
    expect(result.suggestedCommand).toBe(
      "kubectl get pods -A --field-selector=status.phase!=Running",
    );
    expect(result.warnings.join(" ")).toMatch(/did not match non-running pod intent/i);
  });

  it("returns guidance to use chat panel for diagnostic questions", async () => {
    vi.mocked(createConfiguredProviders).mockReturnValue(new Map());

    await expect(
      suggestCommand({
        query: "whats wrong with the imagepull-test pods ?",
        namespace: "default",
      }),
    ).rejects.toMatchObject({
      code: "SUGGESTION_UNAVAILABLE",
    } satisfies Partial<CommandSuggestionError>);
  });
});

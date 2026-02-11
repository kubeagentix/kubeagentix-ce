import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();

vi.mock("../../commands/broker", () => ({
  getCommandBroker: () => ({
    execute: executeMock,
  }),
}));

import { listResources } from "../k8s";

function response(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    executedAt: Date.now(),
    durationMs: 1,
    policyDecision: { allowed: true },
    truncated: false,
    ...overrides,
  } as any;
}

describe("k8s.listResources", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it("parses json resource payloads", async () => {
    executeMock.mockResolvedValueOnce(
      response({
        stdout: JSON.stringify({
          items: [
            {
              kind: "Pod",
              metadata: {
                name: "worker-abc",
                namespace: "dev",
                creationTimestamp: "2026-02-11T00:00:00Z",
              },
              status: { phase: "Running" },
            },
          ],
        }),
      }),
    );

    const result = await listResources({
      resourceType: "pod",
      namespace: "dev",
      context: "kind-voting-app",
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.resources[0].name).toBe("worker-abc");
    expect(result.resources[0].namespace).toBe("dev");
    expect(result.resources[0].status).toBe("running");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to compact table parsing when json output is truncated", async () => {
    executeMock
      .mockResolvedValueOnce(
        response({
          stdout: "{\"items\":[",
          truncated: true,
        }),
      )
      .mockResolvedValueOnce(
        response({
          stdout:
            "Pod troubled imagepull-test-565f5d9cbd-d58tv Pending 2026-02-11T00:00:00Z\n",
        }),
      );

    const result = await listResources({
      resourceType: "pods",
      namespace: "all",
      context: "kind-voting-app",
      limit: 20,
    });

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1][0].command).toContain(
      "--no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name,STATUS:.status.phase,CREATED:.metadata.creationTimestamp",
    );
    expect(result.count).toBe(1);
    expect(result.resources[0].name).toBe("imagepull-test-565f5d9cbd-d58tv");
    expect(result.resources[0].namespace).toBe("troubled");
    expect(result.resources[0].status).toBe("pending");
  });

  it("falls back when json payload cannot be parsed", async () => {
    executeMock
      .mockResolvedValueOnce(
        response({
          stdout: "W0211 unexpected output\nnot-json",
        }),
      )
      .mockResolvedValueOnce(
        response({
          stdout: "Namespace <none> monitoring Active 2026-02-11T00:00:00Z\n",
        }),
      );

    const result = await listResources({
      resourceType: "namespace",
      namespace: "all",
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.resources[0].kind).toBe("Namespace");
    expect(result.resources[0].name).toBe("monitoring");
    expect(result.resources[0].namespace).toBe("monitoring");
    expect(result.resources[0].status).toBe("running");
  });
});


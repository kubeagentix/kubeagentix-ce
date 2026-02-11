import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers } from "../tools";
import { getEvents, listResources } from "../../services/k8s";

vi.mock("../../services/k8s", () => ({
  listResources: vi.fn(),
  describeResource: vi.fn(),
  getPodLogs: vi.fn(),
  getEvents: vi.fn(),
  getClusterMetrics: vi.fn(),
}));

vi.mock("../../commands/broker", () => ({
  getCommandBroker: () => ({
    execute: vi.fn(),
  }),
}));

vi.mock("../../services/skills", () => ({
  executeSkill: vi.fn(),
  getSkillById: vi.fn(),
  listSkills: vi.fn(),
}));

describe("toolHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_namespaces returns namespaces from cluster scope", async () => {
    vi.mocked(listResources).mockResolvedValue({
      resources: [
        { name: "default", status: "running", age: "10d" },
        { name: "dev", status: "running", age: "8d" },
      ],
      count: 2,
    } as any);

    const handler = toolHandlers.get("list_namespaces");
    expect(handler).toBeDefined();

    const result = await handler!({}, {} as any);

    expect(listResources).toHaveBeenCalledWith({
      resourceType: "namespace",
      namespace: "all",
      limit: 200,
    });
    expect(result).toEqual({
      namespaces: [
        { name: "default", status: "running", age: "10d" },
        { name: "dev", status: "running", age: "8d" },
      ],
      count: 2,
    });
  });

  it("list_non_running_pods filters out running pods", async () => {
    vi.mocked(listResources).mockResolvedValue({
      resources: [
        { name: "ok-pod", namespace: "default", status: "running" },
        { name: "bad-pod", namespace: "troubled", status: "error" },
        { name: "pending-pod", namespace: "troubled", status: "pending" },
      ],
      count: 3,
    } as any);

    const handler = toolHandlers.get("list_non_running_pods");
    expect(handler).toBeDefined();

    const result = await handler!({}, {} as any);

    expect(listResources).toHaveBeenCalledWith({
      resourceType: "pod",
      namespace: "all",
      limit: 100,
    });
    expect(result).toEqual({
      namespace: "all",
      pods: [
        { name: "bad-pod", namespace: "troubled", status: "error" },
        { name: "pending-pod", namespace: "troubled", status: "pending" },
      ],
      count: 2,
      totalPodsScanned: 3,
    });
  });

  it("get_resource_events filters warnings when requested", async () => {
    vi.mocked(getEvents).mockResolvedValue({
      events: [
        { id: "1", type: "warning", title: "Failed", description: "CrashLoop", timestamp: "t1" },
        { id: "2", type: "info", title: "Pulled", description: "Pulled image", timestamp: "t2" },
      ],
      count: 2,
    } as any);

    const handler = toolHandlers.get("get_resource_events");
    expect(handler).toBeDefined();

    const result = await handler!(
      { namespace: "dev", event_type: "warning" },
      { namespace: "default", clusterContext: "kind-voting-app" } as any,
    );

    expect(getEvents).toHaveBeenCalledWith({
      namespace: "dev",
      context: "kind-voting-app",
      resourceType: undefined,
      resourceName: undefined,
      limit: undefined,
    });
    expect(result).toEqual({
      events: [
        { id: "1", type: "warning", title: "Failed", description: "CrashLoop", timestamp: "t1" },
      ],
      eventType: "warning",
      totalCount: 2,
      count: 1,
    });
  });

  it("get_resource_events uses context namespace by default", async () => {
    vi.mocked(getEvents).mockResolvedValue({
      events: [],
      count: 0,
    } as any);

    const handler = toolHandlers.get("get_resource_events");
    expect(handler).toBeDefined();

    await handler!(
      { event_type: "all" },
      { namespace: "dev", clusterContext: "kind-voting-app" } as any,
    );

    expect(getEvents).toHaveBeenCalledWith({
      namespace: "dev",
      context: "kind-voting-app",
      resourceType: undefined,
      resourceName: undefined,
      limit: undefined,
    });
  });
});

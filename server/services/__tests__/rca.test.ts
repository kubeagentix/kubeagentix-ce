import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../k8s", () => ({
  describeResource: vi.fn(async () => ({
    resource: {
      status: {
        phase: "Running",
        containerStatuses: [
          {
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
              },
            },
          },
        ],
      },
    },
    yaml: "apiVersion: v1",
  })),
  getEvents: vi.fn(async () => ({
    events: [
      {
        type: "warning",
        title: "BackOff",
        description: "Back-off restarting failed container",
      },
    ],
  })),
  getPodLogs: vi.fn(async () => ({
    logs: "Error: DATABASE_URL not set",
    truncated: false,
  })),
  getClusterMetrics: vi.fn(async () => ({
    cpu: { percentage: 70 },
    memory: { percentage: 60 },
    podCount: 10,
    nodeCount: 3,
  })),
}));

vi.mock("../skills", () => ({
  listSkills: vi.fn(async () => [
    {
      id: "crashloopbackoff-investigation",
      version: "1.0.0",
      name: "CrashLoopBackOff Investigation",
      description: "Investigate CrashLoopBackOff",
      category: "diagnostic",
      tags: ["rca", "crashloop"],
    },
  ]),
}));

import { diagnoseResource } from "../rca";
import {
  describeResource,
  getEvents,
  getPodLogs,
  getClusterMetrics,
} from "../k8s";

describe("rca service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns diagnosis with hypotheses and evidence", async () => {
    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "checkout-svc-ghi789",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.diagnosisId).toBeTruthy();
    expect(diagnosis.hypotheses.length).toBeGreaterThan(0);
    expect(diagnosis.evidence.length).toBeGreaterThan(0);
    expect(diagnosis.recommendations.length).toBeGreaterThan(0);
    expect(diagnosis.analysisMode).toBe("heuristic");
    expect(diagnosis.agentic?.attempted).toBe(false);
    expect(diagnosis.agentic?.used).toBe(false);
    expect(diagnosis.signals?.length).toBeGreaterThan(0);
    expect(diagnosis.confidenceBreakdown?.length).toBeGreaterThan(0);
    expect(diagnosis.analysisNotes?.length).toBeGreaterThan(0);
  });

  it("detects image pull failures", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Pending",
          containerStatuses: [
            {
              state: {
                waiting: {
                  reason: "ImagePullBackOff",
                },
              },
            },
          ],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "Failed",
          description: "pull access denied for private/image:latest",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({ logs: "", truncated: false } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "image-pull-pod",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("image-pull-auth");
    expect(diagnosis.probableRootCause.toLowerCase()).toContain("image pull");
  });

  it("detects image not found variant for image pulls", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Pending",
          containerStatuses: [
            {
              state: {
                waiting: {
                  reason: "ErrImagePull",
                },
              },
            },
          ],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "Failed",
          description: "manifest for private/image:latest not found",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({ logs: "", truncated: false } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "image-not-found-pod",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("image-pull-not-found");
  });

  it("detects pending scheduling issues", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        spec: {
          volumes: [
            {
              name: "app-config",
              configMap: {
                name: "checkout-config",
              },
            },
          ],
        },
        status: {
          phase: "Pending",
          containerStatuses: [],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "FailedScheduling",
          description: "0/3 nodes are available: insufficient cpu",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({ logs: "", truncated: false } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "pending-pod",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("pending-capacity");
  });

  it("detects pending issues caused by taints/affinity mismatch", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Pending",
          containerStatuses: [],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "FailedScheduling",
          description: "0/3 nodes had taint {dedicated: gpu}, that the pod didn't tolerate",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({ logs: "", truncated: false } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "pending-taint-pod",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("pending-constraints");
  });

  it("detects OOM and dependency signals", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              state: {
                terminated: {
                  reason: "OOMKilled",
                },
              },
            },
          ],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "BackOff",
          description: "container restarted due to memory pressure",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({
      logs: "dial tcp 10.0.0.12:5432: connection refused",
      truncated: false,
    } as any);
    vi.mocked(getClusterMetrics).mockResolvedValueOnce({
      cpu: { percentage: 85 },
      memory: { percentage: 92 },
      podCount: 10,
      nodeCount: 3,
    } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "oom-pod",
        namespace: "default",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses.some((hypothesis) => hypothesis.id === "oomkilled")).toBe(true);
    expect(
      diagnosis.hypotheses.some((hypothesis) => hypothesis.id === "dependency-config"),
    ).toBe(true);
  });

  it("detects probe misconfiguration patterns", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              restartCount: 146,
              state: {
                waiting: {
                  reason: "CrashLoopBackOff",
                },
              },
            },
          ],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "Unhealthy",
          description: "Liveness probe failed: HTTP probe failed with statuscode: 500",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({
      logs: "app booting, health endpoint unavailable during initialization",
      truncated: false,
    } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "liveness-probe-test-pod",
        namespace: "troubled",
      },
      useAgentic: false,
    });

    expect(
      diagnosis.hypotheses.some((hypothesis) => hypothesis.id === "probe-misconfiguration"),
    ).toBe(true);
    expect(
      diagnosis.probableRootCause.toLowerCase().includes("probe") ||
        diagnosis.hypotheses[0]?.id === "probe-misconfiguration",
    ).toBe(true);
  });

  it("detects pending mount/config dependency failures", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Pending",
          containerStatuses: [],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          type: "warning",
          title: "FailedMount",
          description:
            "MountVolume.SetUp failed for volume \"app-config\": configmap \"checkout-config\" not found",
        },
      ],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({ logs: "", truncated: false } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "configmap-mount-test-pod",
        namespace: "troubled",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("pending-mount-config");
    expect(
      diagnosis.probableRootCause.toLowerCase().includes("mount") ||
        diagnosis.probableRootCause.toLowerCase().includes("config"),
    ).toBe(true);
    expect(
      diagnosis.signals.some(
        (signal) => signal.id === "sig-image-not-found" && signal.matched,
      ),
    ).toBe(false);
    expect(
      diagnosis.hypotheses.some((hypothesis) => hypothesis.id === "image-pull-not-found"),
    ).toBe(false);
    expect(
      diagnosis.evidence.some(
        (evidence) => evidence.title === "Targeted Verification Steps",
      ),
    ).toBe(true);
    expect(
      diagnosis.evidence.some(
        (evidence) =>
          evidence.title === "Available Evidence Sources" &&
          evidence.detail.includes("kubernetes:"),
      ),
    ).toBe(true);
    expect(
      diagnosis.analysisNotes?.some((note) => note.toLowerCase().includes("iteration 1")),
    ).toBe(true);
  });

  it("marks running pods without negative signals as healthy", async () => {
    vi.mocked(describeResource).mockResolvedValueOnce({
      resource: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              restartCount: 0,
              state: {
                running: {
                  startedAt: "2026-02-11T00:00:00Z",
                },
              },
            },
          ],
        },
      },
      yaml: "apiVersion: v1",
    } as any);
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [],
    } as any);
    vi.mocked(getPodLogs).mockResolvedValueOnce({
      logs: "nginx worker process started",
      truncated: false,
    } as any);

    const diagnosis = await diagnoseResource({
      resource: {
        kind: "pod",
        name: "nginx-healthy-pod",
        namespace: "troubled",
      },
      useAgentic: false,
    });

    expect(diagnosis.hypotheses[0]?.id).toBe("healthy-running");
    expect(diagnosis.probableRootCause.toLowerCase()).toContain("no active incident");
    expect(
      diagnosis.analysisNotes?.some((note) => note.includes("healthy-running")),
    ).toBe(true);
  });
});

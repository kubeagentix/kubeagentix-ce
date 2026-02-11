import { useState, useEffect, useCallback, useRef } from "react";
import {
  correlateMetricSeries,
  normalizeMetricSeries,
} from "@/lib/wasmCore";

export interface MetricValue {
  timestamp: number;
  value: number;
}

export interface ClusterMetrics {
  cpu: {
    usage: number;
    total: number;
    history: MetricValue[];
  };
  memory: {
    usage: number;
    total: number;
    history: MetricValue[];
  };
  network: {
    in: number;
    out: number;
  };
  disk: {
    usage: number;
    total: number;
  };
  podCount: number;
  nodeCount: number;
  deploymentCount: number;
  serviceCount: number;
}

export interface UseMetricsReturn {
  metrics: ClusterMetrics | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function appendHistory(history: MetricValue[], value: number): MetricValue[] {
  const next = [...history, { timestamp: Date.now(), value }];
  return next.slice(-60);
}

/**
 * Hook for fetching cluster metrics from backend /api/k8s/metrics.
 */
export function useMetrics(
  namespace: string = "default",
  clusterContext?: string,
): UseMetricsReturn {
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestCounterRef = useRef(0);

  const fetchMetrics = useCallback(async () => {
    const requestId = ++requestCounterRef.current;
    try {
      if (requestId === requestCounterRef.current) {
        setLoading(true);
        setError(null);
      }

      const response = await fetch(
        `/api/k8s/metrics?namespace=${encodeURIComponent(namespace)}${
          clusterContext ? `&context=${encodeURIComponent(clusterContext)}` : ""
        }`,
      );

      if (!response.ok) {
        let detail = "";
        try {
          const payload = (await response.json()) as {
            error?: string;
            details?: unknown;
          };
          if (typeof payload.error === "string" && payload.error.trim().length > 0) {
            detail = payload.error.trim();
          } else if (typeof payload.details === "string" && payload.details.trim().length > 0) {
            detail = payload.details.trim();
          }
        } catch {
          // Keep fallback message if body is not JSON.
        }

        const suffix = detail ? ` (${detail})` : "";
        throw new Error(`Failed to fetch metrics: ${response.status}${suffix}`);
      }

      const api = await response.json();

      if (requestId !== requestCounterRef.current) {
        return;
      }

      setMetrics((prev) => {
        const cpuHistoryRaw = appendHistory(
          prev?.cpu.history || [],
          Number(api.cpu?.usage || 0),
        );
        const memoryHistoryRaw = appendHistory(
          prev?.memory.history || [],
          Number(api.memory?.usage || 0),
        );

        // Warm up WASM utilities for metric normalization/correlation.
        void (async () => {
          const [normalizedCpu, normalizedMemory] = await Promise.all([
            normalizeMetricSeries(cpuHistoryRaw.map((point) => point.value)),
            normalizeMetricSeries(memoryHistoryRaw.map((point) => point.value)),
          ]);
          await correlateMetricSeries(normalizedCpu, normalizedMemory);
        })();

        return {
          cpu: {
            usage: Number(api.cpu?.usage || 0),
            total: Number(api.cpu?.total || 1),
            history: cpuHistoryRaw,
          },
          memory: {
            usage: Number(api.memory?.usage || 0),
            total: Number(api.memory?.total || 1),
            history: memoryHistoryRaw,
          },
          network: {
            in: Number(api.network?.in || 0),
            out: Number(api.network?.out || 0),
        },
        disk: {
          usage: Number(api.disk?.usage || 0),
          total: Number(api.disk?.total || 0),
        },
        podCount: Number(api.podCount || 0),
        nodeCount: Number(api.nodeCount || 0),
        deploymentCount: Number(api.deploymentCount || 0),
        serviceCount: Number(api.serviceCount || 0),
        };
      });
    } catch (err) {
      if (requestId !== requestCounterRef.current) {
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      if (requestId === requestCounterRef.current) {
        setLoading(false);
      }
    }
  }, [namespace, clusterContext]);

  useEffect(() => {
    fetchMetrics();

    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  return {
    metrics,
    loading,
    error,
    refetch: fetchMetrics,
  };
}

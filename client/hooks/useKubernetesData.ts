import { useState, useEffect, useCallback } from "react";
import { shapeResourceStatus } from "@/lib/wasmCore";

export interface KubernetesResource {
  id: string;
  name: string;
  kind: string;
  namespace: string;
  status: "running" | "error" | "warning" | "pending";
  replicas?: string;
  age: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface K8sEvent {
  id: string;
  type: "warning" | "info" | "success" | "critical";
  title: string;
  description: string;
  timestamp: string;
  involvedObject?: {
    kind: string;
    name: string;
    namespace: string;
  };
}

export interface UseKubernetesDataReturn {
  resources: KubernetesResource[];
  events: K8sEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function toRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;

  const diffMs = Date.now() - ts;
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Hook for fetching Kubernetes resources and events from backend APIs.
 */
export function useKubernetesData(
  resourceType: string = "pod",
  namespace: string = "default",
  clusterContext?: string,
): UseKubernetesDataReturn {
  const [resources, setResources] = useState<KubernetesResource[]>([]);
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [resourceResponse, eventsResponse] = await Promise.all([
        fetch(
          `/api/k8s/resources/${encodeURIComponent(resourceType)}?namespace=${encodeURIComponent(namespace)}&limit=100${
            clusterContext ? `&context=${encodeURIComponent(clusterContext)}` : ""
          }`,
        ),
        fetch(
          `/api/k8s/events?namespace=${encodeURIComponent(namespace)}&limit=20${
            clusterContext ? `&context=${encodeURIComponent(clusterContext)}` : ""
          }`,
        ),
      ]);

      if (!resourceResponse.ok) {
        throw new Error(`Failed to load resources: ${resourceResponse.status}`);
      }

      if (!eventsResponse.ok) {
        throw new Error(`Failed to load events: ${eventsResponse.status}`);
      }

      const resourceData = await resourceResponse.json();
      const eventsData = await eventsResponse.json();

      const normalizedResources = await Promise.all(
        ((resourceData.resources || []) as KubernetesResource[]).map(
          async (resource) => ({
            ...resource,
            status: await shapeResourceStatus(resource.kind, resource.status),
          }),
        ),
      );

      setResources(normalizedResources);
      setEvents(
        ((eventsData.events || []) as K8sEvent[]).map((event) => ({
          ...event,
          timestamp: toRelativeTime(event.timestamp),
        })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch Kubernetes data",
      );
    } finally {
      setLoading(false);
    }
  }, [resourceType, namespace, clusterContext]);

  useEffect(() => {
    fetchData();

    // Real-time polling interval
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    resources,
    events,
    loading,
    error,
    refetch: fetchData,
  };
}

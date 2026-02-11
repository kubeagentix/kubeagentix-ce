import { useState, useCallback, useEffect } from "react";

const CLUSTERS_KEY = "kubeagentix_clusters";
const CLUSTERS_LEGACY_KEY = "kubeagentics_clusters";
const DEFAULT_CLUSTER_KEY = "kubeagentix_default_cluster";
const DEFAULT_CLUSTER_LEGACY_KEY = "kubeagentics_default_cluster";

export interface Cluster {
  id: string;
  name: string;
  context: string;
  status: "connected" | "disconnected";
  isDefault?: boolean;
}

export function useClusterConfig() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [currentCluster, setCurrentCluster] = useState<string | null>(null);

  useEffect(() => {
    // Load clusters from localStorage or API
    const stored =
      localStorage.getItem(CLUSTERS_KEY) ||
      localStorage.getItem(CLUSTERS_LEGACY_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setClusters(parsed);
        localStorage.setItem(CLUSTERS_KEY, JSON.stringify(parsed));
      } catch {
        // Ignore parse error
      }
    }

    const defaultCluster =
      localStorage.getItem(DEFAULT_CLUSTER_KEY) ||
      localStorage.getItem(DEFAULT_CLUSTER_LEGACY_KEY);
    if (defaultCluster) {
      setCurrentCluster(defaultCluster);
      localStorage.setItem(DEFAULT_CLUSTER_KEY, defaultCluster);
    }
  }, []);

  const addCluster = useCallback(
    (cluster: Cluster) => {
      setClusters((prev) => [...prev, cluster]);
      localStorage.setItem(CLUSTERS_KEY, JSON.stringify([...clusters, cluster]));
    },
    [clusters],
  );

  const removeCluster = useCallback((id: string) => {
    setClusters((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const setDefault = useCallback((id: string) => {
    setCurrentCluster(id);
    localStorage.setItem(DEFAULT_CLUSTER_KEY, id);
  }, []);

  return {
    clusters,
    currentCluster,
    addCluster,
    removeCluster,
    setDefault,
  };
}

import { AppShell } from "@/components/layout/AppShell";
import { ClusterHealth } from "@/components/dashboard/ClusterHealth";
import { ResourceList } from "@/components/dashboard/ResourceList";
import { EventsFeed } from "@/components/dashboard/EventsFeed";
import { ServiceDependencyMap } from "@/components/dashboard/ServiceDependencyMap";
import { MetricCorrelationGraph } from "@/components/dashboard/MetricCorrelationGraph";
import { Button } from "@/components/ui/button";
import { Zap, BarChart3, BookOpen } from "lucide-react";
import { useKubernetesData } from "@/hooks/useKubernetesData";
import { useMetrics } from "@/hooks/useMetrics";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import type { KubernetesResource } from "@/hooks/useKubernetesData";
import { useWorkspaceScope } from "@/lib/workspaceScope";

function correlation(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;

  const n = left.length;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / n;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let leftSq = 0;
  let rightSq = 0;

  for (let i = 0; i < n; i++) {
    const dl = left[i] - leftMean;
    const dr = right[i] - rightMean;
    numerator += dl * dr;
    leftSq += dl * dl;
    rightSq += dr * dr;
  }

  if (leftSq === 0 || rightSq === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / (Math.sqrt(leftSq) * Math.sqrt(rightSq))));
}

export default function Dashboard() {
  const navigate = useNavigate();
  const scope = useWorkspaceScope();
  const [selectedResource, setSelectedResource] = useState<KubernetesResource | null>(null);
  const effectiveNamespace =
    scope.workingNamespace && scope.workingNamespace !== "all"
      ? scope.workingNamespace
      : "all";
  const { resources, events, loading, error, refetch } = useKubernetesData(
    "pod",
    effectiveNamespace,
    scope.clusterContext,
  );
  const { metrics } = useMetrics(effectiveNamespace, scope.clusterContext);

  const runningPods = resources.filter((r) => r.status === "running").length;
  const totalPods = metrics?.podCount || resources.length;

  const serviceMapData = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; name: string; status: "healthy" | "warning" | "critical"; replicas: number; traffic: number }
    >();

    const statusPriority = {
      healthy: 0,
      warning: 1,
      critical: 2,
    };

    for (const resource of resources) {
      const labels = resource.labels || {};
      const key =
        labels["app.kubernetes.io/name"] ||
        labels.app ||
        resource.name.split("-").slice(0, -1).join("-") ||
        resource.name;

      const mappedStatus =
        resource.status === "error"
          ? "critical"
          : resource.status === "pending" || resource.status === "warning"
            ? "warning"
            : "healthy";

      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          id: key,
          name: key,
          status: mappedStatus,
          replicas: 1,
          traffic: 0,
        });
      } else {
        existing.replicas += 1;
        if (statusPriority[mappedStatus] > statusPriority[existing.status]) {
          existing.status = mappedStatus;
        }
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.replicas - a.replicas);
  }, [resources]);

  const metricCorrelationData = useMemo(() => {
    const cpu = metrics?.cpu.history?.map((point) => point.value) || [];
    const memory = metrics?.memory.history?.map((point) => point.value) || [];

    if (cpu.length < 3 || memory.length < 3 || cpu.length !== memory.length) {
      return undefined;
    }

    const corr = correlation(cpu, memory);
    return {
      metrics: ["CPU Usage", "Memory Usage"],
      correlations: [
        [1, corr],
        [corr, 1],
      ],
    };
  }, [metrics?.cpu.history, metrics?.memory.history]);

  const diagnosisTarget =
    selectedResource || resources.find((resource) => resource.status !== "running") || resources[0];

  const navigateToDiagnosis = () => {
    if (!diagnosisTarget) return;
    navigate(
      `/quick-dx?kind=${encodeURIComponent(diagnosisTarget.kind)}&name=${encodeURIComponent(diagnosisTarget.name)}&namespace=${encodeURIComponent(diagnosisTarget.namespace)}`,
    );
  };

  return (
    <AppShell mode="dashboard">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Cluster Overview</h1>
            <p className="text-zinc-400">
              Monitor and manage your Kubernetes cluster in real-time
            </p>
          </div>
          <Button
            variant="outline"
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            onClick={refetch}
          >
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        <ClusterHealth
          pods={{
            label: "Pods",
            value: runningPods,
            total: Math.max(totalPods, 1),
            status: runningPods === totalPods ? "healthy" : "warning",
          }}
          nodes={{
            label: "Nodes",
            value: metrics?.nodeCount || 0,
            total: Math.max(metrics?.nodeCount || 0, 1),
            status: "healthy",
          }}
          deployments={{
            label: "Deployments",
            value: metrics?.deploymentCount || 0,
            total: Math.max(metrics?.deploymentCount || 0, 1),
            status: (metrics?.deploymentCount || 0) > 0 ? "healthy" : "warning",
          }}
          services={{
            label: "Services",
            value: metrics?.serviceCount || 0,
            total: Math.max(metrics?.serviceCount || 0, 1),
            status: (metrics?.serviceCount || 0) > 0 ? "healthy" : "warning",
          }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <ResourceList
              resources={resources}
              title="Pods"
              onSelectResource={(resource) => {
                setSelectedResource(resource);
                navigate(
                  `/quick-dx?kind=${encodeURIComponent(resource.kind)}&name=${encodeURIComponent(resource.name)}&namespace=${encodeURIComponent(resource.namespace)}`,
                );
              }}
            />
          </div>

          <div>
            <EventsFeed events={events} />
          </div>
        </div>

        <div className="space-y-6 mb-6">
          <ServiceDependencyMap services={serviceMapData} dependencies={[]} />
          <MetricCorrelationGraph data={metricCorrelationData} />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <Button
              className="bg-orange-700 hover:bg-orange-800 text-white"
              onClick={navigateToDiagnosis}
              disabled={!diagnosisTarget}
            >
              <Zap className="w-4 h-4 mr-2" />
              Diagnose Selected
            </Button>
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() =>
                document
                  .querySelector("h3")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              View Metrics
            </Button>
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => navigate("/runbooks")}
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Run Runbook
            </Button>
          </div>
        </div>

        {loading && (
          <div className="mt-4 text-zinc-500 text-sm">Loading cluster data...</div>
        )}
      </div>
    </AppShell>
  );
}

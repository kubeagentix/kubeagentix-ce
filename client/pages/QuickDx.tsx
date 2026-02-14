import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { AlertCircle, Zap, Check, ExternalLink, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useKubernetesData } from "@/hooks/useKubernetesData";
import { useRcaDiagnosis } from "@/hooks/useRcaDiagnosis";
import { useWorkspaceScope } from "@/lib/workspaceScope";
import { useIncidents } from "@/hooks/useIncidents";

const SeverityIcon = ({
  score,
  isHealthy,
}: {
  score: number;
  isHealthy: boolean;
}) => {
  if (isHealthy) return <CheckCircle2 className="w-6 h-6 text-emerald-500" />;
  if (score >= 85) return <AlertCircle className="w-6 h-6 text-red-500" />;
  if (score >= 65) return <AlertCircle className="w-6 h-6 text-yellow-500" />;
  return <AlertCircle className="w-6 h-6 text-sky-500" />;
};

export default function QuickDx() {
  const scope = useWorkspaceScope();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialName = searchParams.get("name") || "";
  const initialNamespace =
    searchParams.get("namespace") ||
    (scope.workingNamespace && scope.workingNamespace !== "all"
      ? scope.workingNamespace
      : "default");
  const initialKind = searchParams.get("kind") || "Pod";
  const initialNamespaceFilter = searchParams.get("namespace") || scope.workingNamespace || "all";

  const [namespaceFilter, setNamespaceFilter] = useState(initialNamespaceFilter);

  const { resources, loading: resourcesLoading } = useKubernetesData(
    "pod",
    "all",
    scope.clusterContext,
  );
  const { diagnosis, loading, error, diagnose } = useRcaDiagnosis();
  const { createIncident, attachDiagnosis } = useIncidents();

  const [selectedName, setSelectedName] = useState(initialName);
  const [selectedNamespace, setSelectedNamespace] = useState(initialNamespace);
  const [selectedKind, setSelectedKind] = useState(initialKind);
  const [creatingIncident, setCreatingIncident] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);

  const resourceOptions = useMemo(
    () => resources.map((resource) => ({
      name: resource.name,
      namespace: resource.namespace,
      kind: resource.kind,
      label: `${resource.kind}/${resource.name} @ ${resource.namespace}`,
    })),
    [resources],
  );

  const availableNamespaces = useMemo(
    () =>
      Array.from(new Set(resourceOptions.map((option) => option.namespace)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [resourceOptions],
  );

  const filteredResourceOptions = useMemo(() => {
    if (namespaceFilter === "all") return resourceOptions;
    return resourceOptions.filter((option) => option.namespace === namespaceFilter);
  }, [resourceOptions, namespaceFilter]);

  useEffect(() => {
    if (filteredResourceOptions.length === 0) return;

    const selectedStillVisible = filteredResourceOptions.some(
      (option) =>
        option.name === selectedName &&
        option.namespace === selectedNamespace &&
        option.kind === selectedKind,
    );

    if (selectedStillVisible) return;

    setSelectedName(filteredResourceOptions[0].name);
    setSelectedNamespace(filteredResourceOptions[0].namespace);
    setSelectedKind(filteredResourceOptions[0].kind);
  }, [filteredResourceOptions, selectedKind, selectedName, selectedNamespace]);

  const selectedResourceLabel = selectedName
    ? `${selectedKind.toLowerCase()}/${selectedName}`
    : "No resource selected";

  const handleDiagnose = async () => {
    if (!selectedName || !selectedNamespace || !selectedKind) return;

    await diagnose({
      kind: selectedKind,
      name: selectedName,
      namespace: selectedNamespace,
    });
  };

  const handleCreateIncident = async () => {
    if (!diagnosis || creatingIncident) return;

    try {
      setIncidentError(null);
      setCreatingIncident(true);

      const created = await createIncident({
        title: `${diagnosis.resource.kind}/${diagnosis.resource.name} degradation`,
        description: diagnosis.probableRootCause,
        severity: topConfidence >= 85 ? "critical" : topConfidence >= 65 ? "high" : "medium",
        source: "quickdx",
        actor: "quickdx",
        services: [
          diagnosis.resource.name.split("-").slice(0, -1).join("-") || diagnosis.resource.name,
        ],
        entities: [
          {
            id: `${diagnosis.resource.kind.toLowerCase()}/${diagnosis.resource.namespace}/${diagnosis.resource.name}`,
            layer: "app",
            kind: diagnosis.resource.kind,
            name: diagnosis.resource.name,
            namespace: diagnosis.resource.namespace,
          },
        ],
      });

      const updated = await attachDiagnosis(created.id, {
        diagnosisId: diagnosis.diagnosisId,
        attachedBy: "quickdx",
        note: "Promoted from QuickDx",
      });

      navigate(`/incident?incidentId=${encodeURIComponent(updated.id)}`);
    } catch (err) {
      setIncidentError(err instanceof Error ? err.message : "Failed to create incident from diagnosis");
    } finally {
      setCreatingIncident(false);
    }
  };

  const topConfidence = diagnosis?.hypotheses?.[0]?.confidence || 0;
  const isHealthyDiagnosis = diagnosis?.hypotheses?.[0]?.id === "healthy-running";
  const showProviderDebug = import.meta.env.VITE_SHOW_PROVIDER_DEBUG !== "false";

  return (
    <AppShell mode="quickdx">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Quick Diagnosis</h1>
        <p className="text-zinc-400 mb-6">
          Guided RCA for Kubernetes resources with evidence and skill recommendations.
        </p>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}
        {incidentError && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {incidentError}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Select Resource</h2>

          <div className="space-y-3">
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Namespace</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white"
                value={namespaceFilter}
                onChange={(event) => setNamespaceFilter(event.target.value)}
              >
                <option value="all">All namespaces</option>
                {availableNamespaces.map((namespace) => (
                  <option key={namespace} value={namespace}>
                    {namespace}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-zinc-400 block mb-2">Resource</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white"
                value={`${selectedKind}|${selectedNamespace}|${selectedName}`}
                onChange={(event) => {
                  const [kind, namespace, name] = event.target.value.split("|");
                  setSelectedKind(kind);
                  setSelectedNamespace(namespace);
                  setSelectedName(name);
                }}
              >
                {filteredResourceOptions.map((option) => (
                  <option
                    key={`${option.kind}|${option.namespace}|${option.name}`}
                    value={`${option.kind}|${option.namespace}|${option.name}`}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="text-white font-medium">{selectedResourceLabel}</div>
                <div className="text-sm text-zinc-400">@ {selectedNamespace}</div>
              </div>
              <div className="w-2 h-2 bg-orange-500 rounded-full" />
            </div>

            <Button
              onClick={handleDiagnose}
              disabled={loading || resourcesLoading || !selectedName}
              className="w-full bg-orange-700 hover:bg-orange-800 text-white mt-4"
            >
              <Zap className="w-4 h-4 mr-2" />
              {loading ? "Analyzing..." : "Diagnose This Resource"}
            </Button>
          </div>
        </div>

        {diagnosis && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="p-6 border-b border-zinc-800">
              <div className="flex items-start gap-4">
                <SeverityIcon score={topConfidence} isHealthy={isHealthyDiagnosis} />
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-white">
                    Diagnosis: {diagnosis.resource.name}
                  </h2>
                  {isHealthyDiagnosis && (
                    <div className="mt-2 inline-flex items-center rounded-full border border-emerald-700/50 bg-emerald-900/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      Healthy
                    </div>
                  )}
                  <p className="text-sm text-zinc-400 mt-1">
                    Probable root cause confidence: {topConfidence}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Analysis mode:{" "}
                    {diagnosis.analysisMode === "agentic_hybrid"
                      ? "Agentic + Heuristic"
                      : "Heuristic fallback"}
                  </p>
                  {showProviderDebug &&
                    diagnosis.agentic?.used &&
                    diagnosis.agentic?.providerId && (
                      <p className="text-xs text-sky-300/90 mt-1">
                        Debug: provider={diagnosis.agentic.providerId}
                        {diagnosis.agentic.model ? ` model=${diagnosis.agentic.model}` : ""}
                        {diagnosis.agentic.attempt
                          ? ` via ${diagnosis.agentic.attempt}`
                          : ""}
                      </p>
                    )}
                  {diagnosis.analysisMode === "heuristic" &&
                    diagnosis.agentic?.fallbackReason &&
                    !isHealthyDiagnosis && (
                      <p className="text-xs text-amber-300/90 mt-1">
                        Agentic fallback reason: {diagnosis.agentic.fallbackReason}
                      </p>
                    )}
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <section>
                <h3 className="text-lg font-semibold text-white mb-3">Probable Root Cause</h3>
                <p className="text-zinc-300 bg-zinc-800/50 border border-zinc-700 rounded p-4">
                  {diagnosis.probableRootCause}
                </p>
              </section>

              <section>
                <h3 className="text-lg font-semibold text-white mb-3">Top Hypotheses</h3>
                <div className="space-y-2">
                  {diagnosis.hypotheses.map((hypothesis) => (
                    <div
                      key={hypothesis.id}
                      className="flex items-center justify-between p-3 bg-zinc-800/50 border border-zinc-700 rounded"
                    >
                      <span className="text-zinc-300">{hypothesis.title}</span>
                      <span className="text-white font-medium">{hypothesis.confidence}%</span>
                    </div>
                  ))}
                </div>
              </section>

              {diagnosis.signals && diagnosis.signals.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-white mb-3">Detected Signals</h3>
                  <div className="space-y-2">
                    {diagnosis.signals.map((signal) => (
                      <div
                        key={signal.id}
                        className="p-3 bg-zinc-800/50 border border-zinc-700 rounded"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-zinc-200 font-medium">
                            {signal.category.replace("_", " ")}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-zinc-400">
                            {signal.severity}
                          </span>
                        </div>
                        <div className="text-sm text-zinc-400">{signal.detail}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {diagnosis.confidenceBreakdown && diagnosis.confidenceBreakdown.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-white mb-3">Confidence Breakdown</h3>
                  <div className="space-y-3">
                    {diagnosis.confidenceBreakdown.map((entry) => (
                      <div
                        key={entry.hypothesisId}
                        className="p-4 bg-zinc-800/50 border border-zinc-700 rounded"
                      >
                        <div className="text-sm text-zinc-200 font-medium mb-2">
                          {entry.hypothesisId} {"->"} {entry.final}%
                        </div>
                        <div className="text-xs text-zinc-400">
                          Base {entry.base}% | Boosts{" "}
                          {entry.boosts.length > 0
                            ? entry.boosts.map((boost) => `+${boost.delta} ${boost.reason}`).join("; ")
                            : "none"}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-lg font-semibold text-white mb-3">Why This Diagnosis?</h3>
                <div className="space-y-3">
                  {diagnosis.evidence.map((evidence, index) => (
                    <div
                      key={`${evidence.source}-${index}`}
                      className="p-4 bg-zinc-800/50 border border-zinc-700 rounded"
                    >
                      <div className="text-sm font-semibold text-zinc-200 mb-2">
                        {evidence.title}
                      </div>
                      <pre className="text-xs text-zinc-400 whitespace-pre-wrap overflow-x-auto">
                        {evidence.detail}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-lg font-semibold text-white mb-3">Recommended Skills</h3>
                <div className="space-y-3">
                  {diagnosis.recommendations.length === 0 ? (
                    <div className="text-sm text-zinc-500">No matching skills found.</div>
                  ) : (
                    diagnosis.recommendations.map((recommendation) => (
                      <div
                        key={recommendation.id}
                        className="p-4 bg-zinc-800/50 border border-zinc-700 rounded"
                      >
                        <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="font-medium text-white">{recommendation.name}</div>
                            <div className="text-sm text-zinc-400 mt-1">
                              {recommendation.description}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <div className="flex gap-3 flex-wrap">
                <Button
                  className="bg-green-700 hover:bg-green-800 text-white"
                  onClick={() =>
                    navigate(
                      `/runbooks?skill=${encodeURIComponent(diagnosis.recommendations[0]?.id || "")}&kind=${encodeURIComponent(diagnosis.resource.kind)}&name=${encodeURIComponent(diagnosis.resource.name)}&namespace=${encodeURIComponent(diagnosis.resource.namespace)}&diagnosisId=${encodeURIComponent(diagnosis.diagnosisId)}`,
                    )
                  }
                >
                  Open Skill Plan
                </Button>
                <Button
                  variant="outline"
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => void handleCreateIncident()}
                  disabled={creatingIncident}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {creatingIncident ? "Creating Incident..." : "Create / Link Incident"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!diagnosis && !loading && (
          <div className="text-center py-12">
            <Zap className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400">
              Select a resource and run guided diagnosis.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

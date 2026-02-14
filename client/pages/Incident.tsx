import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIncidents } from "@/hooks/useIncidents";
import type { IncidentActionType, IncidentCase, IncidentSeverity, IncidentStatus } from "@shared/incident";
import { CheckCircle2, ExternalLink, RefreshCcw } from "lucide-react";

const STATUS_OPTIONS: IncidentStatus[] = [
  "new",
  "triage",
  "investigating",
  "mitigated",
  "monitoring",
  "resolved",
  "postmortem",
];

const SEVERITY_OPTIONS: IncidentSeverity[] = ["critical", "high", "medium", "low", "warning", "info"];

export default function Incident() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const incidentIdParam = searchParams.get("incidentId") || "";

  const {
    loading,
    error,
    listIncidents,
    getIncident,
    createIncident,
    updateIncident,
    createAction,
    approveAction,
    executeAction,
    investigateIncident,
  } = useIncidents();

  const [incidents, setIncidents] = useState<IncidentCase[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(incidentIdParam);
  const [selectedIncident, setSelectedIncident] = useState<IncidentCase | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newService, setNewService] = useState("");
  const [newSeverity, setNewSeverity] = useState<IncidentSeverity>("high");

  const [actionTitle, setActionTitle] = useState("");
  const [actionType, setActionType] = useState<IncidentActionType>("manual");
  const [actionCommand, setActionCommand] = useState("");
  const [actionSkillId, setActionSkillId] = useState("");
  const [investigationWarnings, setInvestigationWarnings] = useState<string[]>([]);

  const refreshList = useCallback(async () => {
    const data = await listIncidents({
      status: statusFilter || undefined,
      q: query || undefined,
      limit: 100,
    });

    const next: IncidentCase[] = [];
    for (const summary of data.items) {
      try {
        const incident = await getIncident(summary.id);
        next.push(incident);
      } catch {
        // Skip records that cannot be loaded.
      }
    }

    setIncidents(next);

    const preferredId = selectedIncidentId || incidentIdParam;
    if (preferredId) {
      const found = next.find((item) => item.id === preferredId) || null;
      setSelectedIncident(found);
      if (found) {
        setSelectedIncidentId(found.id);
      }
      return;
    }

    if (next.length > 0) {
      setSelectedIncident(next[0]);
      setSelectedIncidentId(next[0].id);
    } else {
      setSelectedIncident(null);
      setSelectedIncidentId("");
    }
  }, [getIncident, incidentIdParam, listIncidents, query, selectedIncidentId, statusFilter]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selectedIncidentId) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("incidentId", selectedIncidentId);
      return next;
    });
  }, [selectedIncidentId, setSearchParams]);

  const selectedTimeline = useMemo(
    () => [...(selectedIncident?.timeline || [])].sort((a, b) => b.timestamp - a.timestamp),
    [selectedIncident?.timeline],
  );

  const handleCreateIncident = async () => {
    if (!newTitle.trim()) return;
    const created = await createIncident({
      title: newTitle.trim(),
      severity: newSeverity,
      source: "manual",
      actor: "operator",
      services: newService.trim() ? [newService.trim()] : [],
    });

    setNewTitle("");
    setNewService("");
    setSelectedIncidentId(created.id);
    setSelectedIncident(created);
    await refreshList();
  };

  const handleSelectIncident = (incident: IncidentCase) => {
    setSelectedIncident(incident);
    setSelectedIncidentId(incident.id);
  };

  const handleUpdateStatus = async (status: IncidentStatus) => {
    if (!selectedIncident) return;
    const updated = await updateIncident(selectedIncident.id, {
      status,
      actor: "operator",
    });
    setSelectedIncident(updated);
    await refreshList();
  };

  const handleCreateAction = async () => {
    if (!selectedIncident || !actionTitle.trim()) return;
    const updated = await createAction(selectedIncident.id, {
      title: actionTitle.trim(),
      type: actionType,
      command: actionType === "command" ? actionCommand.trim() : undefined,
      skillId: actionType === "skill" ? actionSkillId.trim() : undefined,
      proposedBy: "operator",
      requiresApproval: true,
      dryRun: true,
    });
    setSelectedIncident(updated);
    setActionTitle("");
    setActionCommand("");
    setActionSkillId("");
    await refreshList();
  };

  const handleApprove = async (actionId: string) => {
    if (!selectedIncident) return;
    const updated = await approveAction(selectedIncident.id, actionId, {
      actor: "operator",
      approved: true,
    });
    setSelectedIncident(updated);
    await refreshList();
  };

  const handleExecute = async (actionId: string) => {
    if (!selectedIncident) return;
    const updated = await executeAction(selectedIncident.id, actionId, {
      actor: "operator",
      dryRun: true,
    });
    setSelectedIncident(updated);
    await refreshList();
  };

  const handleRunInvestigation = async () => {
    if (!selectedIncident) return;
    const result = await investigateIncident(selectedIncident.id, {
      actor: "operator",
      maxEntities: 200,
    });
    setSelectedIncident(result.incident);
    setInvestigationWarnings(result.warnings);
    await refreshList();
  };

  return (
    <AppShell mode="incident">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Incident Response</h1>
            <p className="text-zinc-400">Service/system-level incident inbox with timeline and approval-gated actions.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => navigate("/quick-dx")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open QuickDx
            </Button>
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => void refreshList()}
            >
              <RefreshCcw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
              <h2 className="text-lg font-semibold text-white">Create Incident</h2>
              <Input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Incident title"
                className="bg-zinc-800 border-zinc-700 text-white"
              />
              <Input
                value={newService}
                onChange={(event) => setNewService(event.target.value)}
                placeholder="Service (optional)"
                className="bg-zinc-800 border-zinc-700 text-white"
              />
              <select
                value={newSeverity}
                onChange={(event) => setNewSeverity(event.target.value as IncidentSeverity)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
              >
                {SEVERITY_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <Button
                className="w-full bg-orange-700 hover:bg-orange-800 text-white"
                onClick={() => void handleCreateIncident()}
                disabled={loading || !newTitle.trim()}
              >
                Create Incident
              </Button>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
              <h2 className="text-lg font-semibold text-white">Incident Inbox</h2>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  className="bg-zinc-800 border-zinc-700 text-white col-span-2"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white col-span-2"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 max-h-[460px] overflow-y-auto">
                {incidents.length === 0 && (
                  <div className="text-sm text-zinc-500">No incidents found.</div>
                )}
                {incidents.map((incident) => (
                  <button
                    key={incident.id}
                    className={`w-full text-left rounded border px-3 py-2 transition-colors ${
                      selectedIncident?.id === incident.id
                        ? "border-orange-700 bg-orange-950/30"
                        : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-500"
                    }`}
                    onClick={() => handleSelectIncident(incident)}
                  >
                    <div className="text-sm font-medium text-white">{incident.title}</div>
                    <div className="text-xs text-zinc-400 mt-1">
                      {incident.status} • {incident.severity} • {incident.source}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {!selectedIncident ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-zinc-500">
                Select an incident from the inbox.
              </div>
            ) : (
              <>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-white">{selectedIncident.title}</h2>
                      <p className="text-sm text-zinc-400 mt-1">{selectedIncident.description || "No description"}</p>
                      <div className="text-xs text-zinc-500 mt-2">ID: {selectedIncident.id}</div>
                    </div>
                    <div className="text-right text-xs text-zinc-400">
                      <div>Source: {selectedIncident.source}</div>
                      <div>Severity: {selectedIncident.severity}</div>
                      <div>Owner: {selectedIncident.owner || "unassigned"}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {STATUS_OPTIONS.map((status) => (
                      <Button
                        key={status}
                        variant={selectedIncident.status === status ? "default" : "outline"}
                        className={
                          selectedIncident.status === status
                            ? "bg-orange-700 hover:bg-orange-800 text-white"
                            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        }
                        onClick={() => void handleUpdateStatus(status)}
                        disabled={loading}
                      >
                        {status}
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      className="border-sky-700 text-sky-300 hover:bg-sky-900/30"
                      onClick={() => void handleRunInvestigation()}
                      disabled={loading}
                    >
                      Run Layered Investigation
                    </Button>
                  </div>
                  {investigationWarnings.length > 0 && (
                    <div className="mt-3 rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                      Investigation warnings: {investigationWarnings.length}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Graph Entities</h3>
                    <div className="text-xs text-zinc-500 mb-3">
                      {(selectedIncident.entities || []).length} entities
                    </div>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto">
                      {(selectedIncident.entities || []).slice(0, 20).map((entity) => (
                        <div key={entity.id} className="rounded border border-zinc-700 bg-zinc-800/40 px-3 py-2">
                          <div className="text-sm text-zinc-200">
                            {entity.kind}/{entity.name}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {entity.layer}
                            {entity.namespace ? ` • ${entity.namespace}` : ""}
                          </div>
                        </div>
                      ))}
                      {(selectedIncident.entities || []).length === 0 && (
                        <div className="text-sm text-zinc-500">No graph entities yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Graph Edges</h3>
                    <div className="text-xs text-zinc-500 mb-3">
                      {(selectedIncident.graphEdges || []).length} edges
                    </div>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto">
                      {(selectedIncident.graphEdges || []).slice(0, 20).map((edge) => (
                        <div key={edge.id} className="rounded border border-zinc-700 bg-zinc-800/40 px-3 py-2">
                          <div className="text-sm text-zinc-200">{edge.relationship}</div>
                          <div className="text-xs text-zinc-500">confidence {edge.confidence}%</div>
                        </div>
                      ))}
                      {(selectedIncident.graphEdges || []).length === 0 && (
                        <div className="text-sm text-zinc-500">No graph edges yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Correlations</h3>
                    <div className="text-xs text-zinc-500 mb-3">
                      {(selectedIncident.correlations || []).length} signals
                    </div>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto">
                      {(selectedIncident.correlations || []).slice(0, 20).map((correlation) => (
                        <div key={correlation.signalId} className="rounded border border-zinc-700 bg-zinc-800/40 px-3 py-2">
                          <div className="text-sm text-zinc-200">{correlation.signalId}</div>
                          <div className="text-xs text-zinc-500">
                            confidence {correlation.confidence}% • {correlation.rationale}
                          </div>
                        </div>
                      ))}
                      {(selectedIncident.correlations || []).length === 0 && (
                        <div className="text-sm text-zinc-500">No correlations yet.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Timeline</h3>
                    <div className="space-y-3 max-h-[420px] overflow-y-auto">
                      {selectedTimeline.length === 0 && (
                        <div className="text-sm text-zinc-500">No timeline events yet.</div>
                      )}
                      {selectedTimeline.map((event) => (
                        <div key={event.id} className="border border-zinc-700 rounded p-3 bg-zinc-800/40">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium text-zinc-200">{event.message}</div>
                            <div className="text-xs text-zinc-500">{new Date(event.timestamp).toLocaleString()}</div>
                          </div>
                          <div className="text-xs text-zinc-400 mt-1">
                            {event.type} • {event.source} • {event.actor}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-3">Diagnoses</h3>
                      <div className="space-y-2">
                        {selectedIncident.diagnoses.length === 0 && (
                          <div className="text-sm text-zinc-500">No QuickDx diagnoses linked yet.</div>
                        )}
                        {selectedIncident.diagnoses.map((diagnosis) => (
                          <div key={diagnosis.diagnosisId} className="border border-zinc-700 rounded p-3 bg-zinc-800/40">
                            <div className="text-sm font-medium text-zinc-200">{diagnosis.probableRootCause}</div>
                            <div className="text-xs text-zinc-400 mt-1">
                              {diagnosis.resource.kind}/{diagnosis.resource.namespace}/{diagnosis.resource.name}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-3">Actions</h3>

                      <div className="space-y-2 mb-3">
                        <Input
                          value={actionTitle}
                          onChange={(event) => setActionTitle(event.target.value)}
                          placeholder="Action title"
                          className="bg-zinc-800 border-zinc-700 text-white"
                        />
                        <select
                          value={actionType}
                          onChange={(event) => setActionType(event.target.value as IncidentActionType)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
                        >
                          <option value="manual">manual</option>
                          <option value="command">command</option>
                          <option value="skill">skill</option>
                        </select>
                        {actionType === "command" && (
                          <Input
                            value={actionCommand}
                            onChange={(event) => setActionCommand(event.target.value)}
                            placeholder="kubectl get pods -A"
                            className="bg-zinc-800 border-zinc-700 text-white"
                          />
                        )}
                        {actionType === "skill" && (
                          <Input
                            value={actionSkillId}
                            onChange={(event) => setActionSkillId(event.target.value)}
                            placeholder="skill id"
                            className="bg-zinc-800 border-zinc-700 text-white"
                          />
                        )}
                        <Button
                          className="w-full bg-sky-700 hover:bg-sky-800 text-white"
                          onClick={() => void handleCreateAction()}
                          disabled={loading || !actionTitle.trim()}
                        >
                          Add Action Proposal
                        </Button>
                      </div>

                      <div className="space-y-2 max-h-[260px] overflow-y-auto">
                        {selectedIncident.actions.length === 0 && (
                          <div className="text-sm text-zinc-500">No actions proposed yet.</div>
                        )}
                        {selectedIncident.actions.map((action) => (
                          <div key={action.id} className="border border-zinc-700 rounded p-3 bg-zinc-800/40">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium text-zinc-200">{action.title}</div>
                              <div className="text-xs text-zinc-400">{action.approvalState}</div>
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">
                              {action.type} • risk={action.risk}
                            </div>
                            {action.execution?.success && (
                              <div className="text-xs text-green-400 mt-1 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> executed (success)
                              </div>
                            )}
                            {action.execution && !action.execution.success && (
                              <div className="text-xs text-red-400 mt-1">executed (failed)</div>
                            )}
                            <div className="mt-2 flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                                onClick={() => void handleApprove(action.id)}
                                disabled={loading || action.approvalState !== "pending"}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                className="bg-orange-700 hover:bg-orange-800 text-white"
                                onClick={() => void handleExecute(action.id)}
                                disabled={
                                  loading ||
                                  (action.requiresApproval && action.approvalState !== "approved")
                                }
                              >
                                Execute (Dry Run)
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRcaDiagnosis } from "@/hooks/useRcaDiagnosis";
import { getIncidentExecutionSnapshot, IncidentExecutionSnapshot } from "@/hooks/useRunbookExecution";

interface TimelineEvent {
  time: string;
  title: string;
  status: "complete" | "pending";
}

function asClockTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

export default function Incident() {
  const [searchParams] = useSearchParams();
  const diagnosisId = searchParams.get("diagnosisId");

  const { diagnosis, fetchDiagnosis } = useRcaDiagnosis();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionSnapshot, setExecutionSnapshot] =
    useState<IncidentExecutionSnapshot | null>(null);

  useEffect(() => {
    if (!diagnosisId) return;

    setLoading(true);
    setError(null);
    fetchDiagnosis(diagnosisId)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load incident context");
      })
      .finally(() => setLoading(false));
  }, [diagnosisId, fetchDiagnosis]);

  useEffect(() => {
    setExecutionSnapshot(getIncidentExecutionSnapshot(diagnosisId));
  }, [diagnosisId, diagnosis?.diagnosisId]);

  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!diagnosis) {
      return [
        {
          time: "--:--",
          title: "No diagnosis selected",
          status: "pending" as const,
        },
      ];
    }

    return [
      {
        time: asClockTime(diagnosis.generatedAt),
        title: `Diagnosis generated for ${diagnosis.resource.name}`,
        status: "complete" as const,
      },
      ...diagnosis.hypotheses.map((hypothesis) => ({
        time: asClockTime(diagnosis.generatedAt),
        title: `Hypothesis (${hypothesis.confidence}%): ${hypothesis.title}`,
        status: "complete" as const,
      })),
      ...(executionSnapshot
        ? [
            {
              time: asClockTime(executionSnapshot.updatedAt),
              title: `Skill plan reviewed (${executionSnapshot.runbookId})`,
              status: "complete" as const,
            },
            {
              time: asClockTime(executionSnapshot.updatedAt),
              title:
                executionSnapshot.status === "completed"
                  ? "Skill execution completed and verification data collected"
                  : "Skill execution attempted with failures; review next safe action",
              status:
                executionSnapshot.status === "completed"
                  ? ("complete" as const)
                  : ("pending" as const),
            },
          ]
        : []),
      {
        time: "NOW",
        title: executionSnapshot
          ? "Next safe action ready for operator confirmation"
          : "Awaiting operator action and skill execution",
        status: "pending" as const,
      },
    ].slice(0, 7);
  }, [diagnosis, executionSnapshot]);

  const impactEstimate = diagnosis?.hypotheses?.[0]?.confidence || 0;

  return (
    <AppShell mode="incident">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Incident Response</h1>
        <p className="text-zinc-400 mb-6">
          Evidence-backed incident context from guided RCA.
        </p>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        <div className="bg-zinc-900 border border-red-900/30 rounded-lg p-6 mb-6">
          <div className="flex items-start gap-4 mb-4">
            <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-white">
                {diagnosis
                  ? `INC-${diagnosis.generatedAt}: ${diagnosis.resource.kind}/${diagnosis.resource.name}`
                  : "INC-UNKNOWN: No diagnosis selected"}
              </h2>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-zinc-400">
                <span>
                  Started: {diagnosis ? new Date(diagnosis.generatedAt).toLocaleString() : "N/A"}
                </span>
                <span className="text-red-400">Severity: P1</span>
                <span>
                  Namespace: {diagnosis?.resource.namespace || "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400 mb-2">Root Cause Confidence</div>
            <div className="text-3xl font-bold text-red-500">{impactEstimate}%</div>
            <div className="text-xs text-zinc-500 mt-2">Top RCA hypothesis score</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400 mb-2">Evidence Signals</div>
            <div className="text-3xl font-bold text-orange-500">{diagnosis?.evidence.length || 0}</div>
            <div className="text-xs text-zinc-500 mt-2">Logs, events, metrics, status</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400 mb-2">Recommended Skills</div>
            <div className="text-3xl font-bold text-yellow-500">
              {diagnosis?.recommendations.length || 0}
            </div>
            <div className="text-xs text-zinc-500 mt-2">Actionable next steps</div>
          </div>
        </div>

        {executionSnapshot && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
            <div className="text-sm text-zinc-400 mb-2">Latest Skill Verification</div>
            <div className="text-white font-medium">
              {executionSnapshot.runbookId} - {executionSnapshot.status}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Updated: {new Date(executionSnapshot.updatedAt).toLocaleString()}
            </div>
            {executionSnapshot.error && (
              <div className="text-sm text-red-400 mt-2">{executionSnapshot.error}</div>
            )}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Incident Timeline</h3>
          <div className="relative">
            {timeline.map((event, idx) => (
              <div key={`${event.time}-${idx}`} className="flex gap-4 pb-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                      event.status === "complete"
                        ? "border-green-500 bg-green-500/20"
                        : "border-yellow-500 bg-yellow-500/20"
                    }`}
                  >
                    {event.status === "complete" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-yellow-500" />
                    )}
                  </div>
                  {idx < timeline.length - 1 && <div className="w-0.5 h-8 bg-zinc-700 mt-2" />}
                </div>
                <div className="pt-1">
                  <div className="text-sm font-medium text-zinc-400">{event.time}</div>
                  <div className="text-white">{event.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">AI Analysis</h3>

          {loading ? (
            <div className="text-zinc-400">Loading incident details...</div>
          ) : diagnosis ? (
            <>
              <section className="mb-6">
                <h4 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-2">
                  Root Cause
                </h4>
                <p className="text-white bg-zinc-800/50 border border-zinc-700 rounded p-4">
                  {diagnosis.probableRootCause}
                </p>
              </section>

              <section className="mb-6">
                <h4 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-2">
                  Supporting Evidence
                </h4>
                <ul className="space-y-2 text-zinc-300">
                  {diagnosis.evidence.slice(0, 3).map((evidence, index) => (
                    <li key={`${evidence.source}-${index}`} className="flex items-start gap-2">
                      <span className="text-orange-500">•</span>
                      <span>{evidence.title}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {executionSnapshot && (
                <section className="mb-6">
                  <h4 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-2">
                    Verification Checkpoints
                  </h4>
                  <ul className="space-y-2 text-zinc-300">
                    {executionSnapshot.steps.slice(0, 5).map((step) => (
                      <li key={`${step.step}-${step.name}`} className="flex items-start gap-2">
                        <span className="text-orange-500">•</span>
                        <span>
                          Step {step.step}: {step.name} ({step.status})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h4 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-3">
                  Recommended Actions
                </h4>
                <div className="space-y-2">
                  {diagnosis.recommendations.map((recommendation) => (
                    <div
                      key={recommendation.id}
                      className="flex items-center gap-3 p-3 bg-zinc-800/50 border border-zinc-700 rounded"
                    >
                      <input type="checkbox" className="w-4 h-4" />
                      <span className="text-white">{recommendation.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="text-zinc-500">
              Open this page from Quick Diagnosis to load a specific incident context.
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button className="bg-green-700 hover:bg-green-800 text-white">Approve All</Button>
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Approve Selected
          </Button>
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Escalate
          </Button>
          <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Close Incident
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

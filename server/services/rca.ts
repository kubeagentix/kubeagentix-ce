import { v4 as uuidv4 } from "uuid";
import {
  RcaConfidenceContribution,
  RcaDiagnoseRequest,
  RcaDiagnoseResponse,
  RcaHypothesis,
  RcaSignal,
} from "@shared/rca";
import { AgentRequest } from "@shared/coordination";
import {
  describeResource,
  getEvents,
  getPodLogs,
  getClusterMetrics,
} from "./k8s";
import { listSkills } from "./skills";
import { resolveScope } from "./scopeResolver";
import { getAgentEngine } from "../agent/engine";
import { createProvider } from "../agent/providers";

const diagnosisStore = new Map<string, RcaDiagnoseResponse>();

interface AgenticRcaOutput {
  probableRootCause: string;
  hypotheses: RcaHypothesis[];
  analysisNote?: string;
}

interface HeuristicRcaOutput {
  probableRootCause: string;
  hypotheses: RcaHypothesis[];
  signals: RcaSignal[];
  confidenceBreakdown: RcaConfidenceContribution[];
  analysisNotes: string[];
}

interface SynthesisInputEvent {
  type: string;
  title: string;
  description: string;
}

interface HypothesisSynthesisOutput {
  summary: string;
  trace: string;
  highlights: string;
  note: string;
}

interface TargetedAdjustment {
  hypothesisId: string;
  delta: number;
  reason: string;
}

interface TargetedIterationOutput {
  evidenceItems: RcaDiagnoseResponse["evidence"];
  analysisNotes: string[];
  adjustments: TargetedAdjustment[];
}

function clampConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function toHypothesisId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function sanitizeJsonCandidate(candidate: string): string {
  return candidate
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function looksLikeJsonFragment(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if ((value.startsWith("{") && !value.endsWith("}")) || value.includes('"probableRootCause"')) {
    return true;
  }
  return /^[\[{]/.test(value) && /[:",]/.test(value);
}

function extractJsonObjectCandidates(raw: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function parseAgenticRcaProse(raw: string): AgenticRcaOutput | null {
  const text = raw.trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const probableRootCauseMatch = text.match(
    /(?:probable\s+root\s+cause|root\s+cause)\s*[:\-]\s*(.+)/i,
  );
  let probableRootCause = probableRootCauseMatch?.[1]?.trim() || "";

  const bulletLines = lines
    .map((line) => line.replace(/^\s*[-*]\s+/, ""))
    .map((line) => line.replace(/^\s*\d+[.)]\s+/, ""))
    .filter((line) => line.length > 8)
    .filter(
      (line) =>
        !/^(hypotheses?|top hypotheses?|analysis note|probable root cause|root cause)\b/i.test(
          line,
        ),
    );

  if (!probableRootCause && bulletLines.length > 0) {
    probableRootCause = bulletLines[0];
  }

  if (!probableRootCause) {
    probableRootCause =
      lines.find((line) => line.length > 16 && !line.endsWith(":")) || "";
  }

  probableRootCause = probableRootCause
    .replace(/\*\*/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (
    !probableRootCause ||
    probableRootCause.length < 10 ||
    looksLikeJsonFragment(probableRootCause)
  ) {
    return null;
  }

  const analysisNoteMatch = text.match(/analysis\s+note\s*[:\-]\s*(.+)/i);
  const hypotheses: RcaHypothesis[] = [];
  const used = new Set<string>();

  for (const [index, lineRaw] of bulletLines.slice(0, 6).entries()) {
    const confidenceMatch = lineRaw.match(/(\d{1,3})\s*%/);
    const confidence = clampConfidence(
      confidenceMatch?.[1],
      Math.max(40, 78 - index * 8),
    );
    const summary = lineRaw
      .replace(/\(\s*\d{1,3}\s*%\s*\)/g, "")
      .replace(/\s+\d{1,3}\s*%/g, "")
      .trim();
    if (!summary || summary.length < 8 || looksLikeJsonFragment(summary)) continue;
    const id = toHypothesisId(summary);
    if (used.has(id)) continue;
    used.add(id);
    hypotheses.push({
      id,
      title: summary,
      confidence,
      summary,
    });
    if (hypotheses.length >= 3) break;
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: toHypothesisId(probableRootCause),
      title: probableRootCause,
      confidence: 68,
      summary: probableRootCause,
    });
  }

  return {
    probableRootCause,
    hypotheses,
    analysisNote: analysisNoteMatch?.[1]?.trim(),
  };
}

export function parseAgenticRcaText(raw: string): AgenticRcaOutput | null {
  if (!raw.trim()) return null;

  const candidates: string[] = [];
  const codeBlockMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    candidates.push(codeBlockMatch[1].trim());
  }

  candidates.push(raw.trim());
  candidates.push(...extractJsonObjectCandidates(raw));

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(raw.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(sanitizeJsonCandidate(candidate)) as {
        probableRootCause?: string;
        hypotheses?: Array<{ id?: string; title?: string; confidence?: number; summary?: string }>;
        analysisNote?: string;
      };

      const probableRootCause = (parsed.probableRootCause || "").trim();
      if (!probableRootCause || looksLikeJsonFragment(probableRootCause)) continue;

      const hypotheses = (parsed.hypotheses || [])
        .filter((item) => typeof item?.title === "string" && typeof item?.summary === "string")
        .map((item, index) => {
          const title = (item.title || "").trim();
          return {
            id: (item.id || "").trim() || toHypothesisId(title || `hypothesis-${index + 1}`),
            title: title || `Hypothesis ${index + 1}`,
            confidence: clampConfidence(item.confidence, 65 - index * 5),
            summary: (item.summary || "").trim(),
          } satisfies RcaHypothesis;
        })
        .filter(
          (item) =>
            item.summary.length > 0 &&
            !looksLikeJsonFragment(item.summary) &&
            !looksLikeJsonFragment(item.title),
        )
        .slice(0, 3);

      if (hypotheses.length === 0) continue;

      return {
        probableRootCause,
        hypotheses,
        analysisNote: parsed.analysisNote?.trim(),
      };
    } catch {
      // Try next candidate representation.
    }
  }

  return parseAgenticRcaProse(raw);
}

async function runAgenticRcaAnalysis(params: {
  resource: { kind: string; name: string; namespace: string };
  clusterContext?: string;
  statusPhase?: string;
  events: Array<{ type: string; title: string; description: string }>;
  metricsSummary: string;
  logSnippet: string;
  modelPreferences?: RcaDiagnoseRequest["modelPreferences"];
}): Promise<{ output: AgenticRcaOutput | null; error?: string }> {
  const engine = getAgentEngine();
  if (
    params.modelPreferences?.providerId &&
    (params.modelPreferences?.apiKey || params.modelPreferences?.authToken)
  ) {
    try {
      const transientProvider = createProvider(
        params.modelPreferences.providerId,
        params.modelPreferences.apiKey,
        params.modelPreferences.authToken,
      );
      engine.registerProvider(transientProvider);
    } catch (error) {
      return {
        output: null,
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize selected provider",
      };
    }
  }

  const promptVariants = [
    {
      eventLimit: 8,
      logExcerpt: params.logSnippet,
      label: "full",
    },
    {
      eventLimit: 4,
      logExcerpt: params.logSnippet.slice(0, 1200),
      label: "compact",
    },
  ];

  const errors: string[] = [];

  for (const variant of promptVariants) {
    const prompt = [
      "You are KubeAgentiX RCA analyst.",
      "Diagnose this Kubernetes incident and return STRICT JSON only.",
      "Schema:",
      '{"probableRootCause":"string","hypotheses":[{"id":"string","title":"string","confidence":0,"summary":"string"}],"analysisNote":"string"}',
      "Rules:",
      "- hypotheses max 3",
      "- confidence must be 0..100",
      "- evidence-first, concise",
      "- no markdown, no prose outside JSON",
      "",
      `Resource: ${params.resource.kind}/${params.resource.name} namespace=${params.resource.namespace}`,
      `Phase: ${params.statusPhase || "unknown"}`,
      `Metrics: ${params.metricsSummary}`,
      "Recent events:",
      params.events
        .slice(0, variant.eventLimit)
        .map((event) => `- ${event.type.toUpperCase()}: ${event.title} :: ${event.description}`)
        .join("\n") || "- none",
      "Log excerpt:",
      variant.logExcerpt || "(none)",
    ].join("\n");

    const request: AgentRequest = {
      conversationId: `rca-${uuidv4()}`,
      userId: "kubeagentix-rca",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      context: {
        cluster: params.clusterContext || "active-context",
        namespace: params.resource.namespace,
        selectedResources: [`${params.resource.kind}/${params.resource.name}`],
        timeRange: "1h",
      },
      // RCA already has normalized evidence. Keep LLM synthesis tool-less for determinism.
      toolPreferences: {
        selectedTools: [],
        maxToolCalls: 0,
      },
      modelPreferences: {
        providerId: params.modelPreferences?.providerId,
        model: params.modelPreferences?.model,
        temperature: 0.1,
        maxTokens: 1200,
        useExtendedThinking: false,
      },
    };

    let text = "";
    let error: string | undefined;

    for await (const chunk of engine.processRequest(request)) {
      if (chunk.type === "text" && chunk.text) {
        text += chunk.text;
      }

      if (chunk.type === "error") {
        error = chunk.error?.message || "Agent RCA failed";
        break;
      }
    }

    if (error) {
      errors.push(`${variant.label} attempt: ${error}`);
      continue;
    }

    const parsed = parseAgenticRcaText(text);
    if (parsed) {
      return { output: parsed };
    }

    errors.push(`${variant.label} attempt: Agent output was not parseable JSON`);
  }

  return { output: null, error: errors.join(" | ") || "Agent analysis unavailable" };
}

function buildHeuristicHypotheses(
  resource: any,
  events: any[],
  logSnippet: string,
): HeuristicRcaOutput {
  const status = resource?.status || {};
  const containerStatuses = Array.isArray(status.containerStatuses)
    ? status.containerStatuses
    : [];

  const waitingReasons = containerStatuses
    .map((entry: any) => entry?.state?.waiting?.reason)
    .filter(Boolean);

  const terminatedReasons = containerStatuses
    .map((entry: any) => entry?.state?.terminated?.reason)
    .filter(Boolean);
  const totalRestarts = containerStatuses.reduce(
    (sum: number, entry: any) => sum + Number(entry?.restartCount || 0),
    0,
  );

  const eventText = events
    .map((event) => `${event.title} ${event.description}`.toLowerCase())
    .join("\n");
  const logsText = logSnippet.toLowerCase();
  const signals: RcaSignal[] = [];
  const addSignal = (signal: RcaSignal) => {
    signals.push(signal);
    return signal.id;
  };

  const warningEvents = events.filter((event) => event.type === "warning");
  const statusPhase = String(status.phase || "");
  const isCrashLoop = waitingReasons.includes("CrashLoopBackOff");
  const isImagePull =
    waitingReasons.includes("ImagePullBackOff") || waitingReasons.includes("ErrImagePull");
  const isPending = statusPhase === "Pending";
  const isOomKilled =
    terminatedReasons.includes("OOMKilled") || logsText.includes("out of memory");
  const hasDependencySignals =
    logsText.includes("database_url") ||
    logsText.includes("connection refused") ||
    logsText.includes("dial tcp") ||
    logsText.includes("timeout");
  const hasImageNotFoundSignals =
    eventText.includes("manifest unknown") ||
    (eventText.includes("not found") &&
      (eventText.includes("pull") ||
        eventText.includes("image") ||
        eventText.includes("manifest")));
  const hasMountFailureSignals =
    eventText.includes("failedmount") ||
    eventText.includes("unable to attach or mount volumes") ||
    eventText.includes("failed to sync configmap cache") ||
    (eventText.includes("configmap") && eventText.includes("not found")) ||
    (eventText.includes("secret") && eventText.includes("not found"));
  const hasProbeFailureSignals =
    eventText.includes("liveness probe failed") ||
    eventText.includes("readiness probe failed") ||
    eventText.includes("startup probe failed") ||
    eventText.includes("unhealthy");

  const crashLoopSignal = addSignal({
    id: "sig-crashloop-state",
    category: "crashloop",
    matched: isCrashLoop,
    detail: isCrashLoop
      ? "Container waiting reason includes CrashLoopBackOff."
      : "CrashLoopBackOff state not detected.",
    source: "status",
    severity: isCrashLoop ? "high" : "low",
  });

  const missingConfigSignal = addSignal({
    id: "sig-missing-config",
    category: "dependency",
    matched:
      logsText.includes("not set") || logsText.includes("missing") || logsText.includes("null"),
    detail: "Logs include missing/not-set configuration indicators.",
    source: "log",
    severity: "high",
  });

  const imagePullSignal = addSignal({
    id: "sig-image-pull-state",
    category: "image_pull",
    matched: isImagePull,
    detail: isImagePull
      ? "Container waiting reason includes image pull failure."
      : "Image pull waiting reason not detected.",
    source: "status",
    severity: isImagePull ? "high" : "low",
  });

  const imageAuthSignal = addSignal({
    id: "sig-image-auth",
    category: "image_pull",
    matched: eventText.includes("pull access denied") || eventText.includes("unauthorized"),
    detail: "Events include registry authorization failure hints.",
    source: "event",
    severity: "high",
  });

  const imageNotFoundSignal = addSignal({
    id: "sig-image-not-found",
    category: "image_pull",
    matched: hasImageNotFoundSignals,
    detail: "Events include image not found hints.",
    source: "event",
    severity: "medium",
  });

  const pendingSignal = addSignal({
    id: "sig-pending-state",
    category: "scheduling",
    matched: isPending,
    detail: isPending ? "Pod phase is Pending." : "Pending phase not detected.",
    source: "status",
    severity: isPending ? "high" : "low",
  });

  const insufficientSignal = addSignal({
    id: "sig-insufficient-resources",
    category: "scheduling",
    matched: eventText.includes("insufficient"),
    detail: "Events include insufficient resource capacity hints.",
    source: "event",
    severity: "high",
  });

  const taintSignal = addSignal({
    id: "sig-taint-affinity",
    category: "scheduling",
    matched: eventText.includes("taint") || eventText.includes("didn't match"),
    detail: "Events include taint/affinity mismatch hints.",
    source: "event",
    severity: "medium",
  });

  const mountFailureSignal = addSignal({
    id: "sig-mount-failure",
    category: "scheduling",
    matched: hasMountFailureSignals,
    detail: hasMountFailureSignals
      ? "Events indicate volume mount failure or missing ConfigMap/Secret dependency."
      : "No mount/config dependency failure events detected.",
    source: "event",
    severity: hasMountFailureSignals ? "high" : "low",
  });

  const oomSignal = addSignal({
    id: "sig-oomkilled",
    category: "memory",
    matched: isOomKilled,
    detail: isOomKilled
      ? "Container terminated with OOM signal or logs contain memory errors."
      : "OOM signal not detected.",
    source: "status",
    severity: isOomKilled ? "high" : "low",
  });

  const dependencySignal = addSignal({
    id: "sig-dependency-connectivity",
    category: "dependency",
    matched: hasDependencySignals,
    detail: "Logs include downstream connectivity/configuration failure hints.",
    source: "log",
    severity: hasDependencySignals ? "high" : "low",
  });

  const warningSignal = addSignal({
    id: "sig-warning-events",
    category: "events",
    matched: warningEvents.length > 0,
    detail: `Found ${warningEvents.length} warning event(s) for this resource.`,
    source: "event",
    severity: warningEvents.length >= 3 ? "high" : warningEvents.length > 0 ? "medium" : "low",
  });

  const probeFailureSignal = addSignal({
    id: "sig-probe-failure",
    category: "resource_state",
    matched: hasProbeFailureSignals,
    detail: hasProbeFailureSignals
      ? "Events indicate failed health probes (liveness/readiness/startup)."
      : "No explicit health probe failure events detected.",
    source: "event",
    severity: hasProbeFailureSignals ? "high" : "low",
  });

  const restartChurnSignal = addSignal({
    id: "sig-restart-churn",
    category: "resource_state",
    matched: totalRestarts >= 5,
    detail:
      totalRestarts >= 5
        ? `High restart churn detected (${totalRestarts} restarts across containers).`
        : `Restart churn is low (${totalRestarts} restarts).`,
    source: "status",
    severity: totalRestarts >= 20 ? "high" : totalRestarts >= 5 ? "medium" : "low",
  });

  const toContribution = (
    hypothesisId: string,
    base: number,
    boosts: Array<{ signalId: string; delta: number; reason: string }>,
    penalties: Array<{ signalId: string; delta: number; reason: string }> = [],
  ): RcaConfidenceContribution => {
    const boostSum = boosts.reduce((acc, item) => acc + item.delta, 0);
    const penaltySum = penalties.reduce((acc, item) => acc + item.delta, 0);
    return {
      hypothesisId,
      base,
      boosts,
      penalties,
      final: clampConfidence(base + boostSum - penaltySum, base),
    };
  };

  const confidenceBreakdown: RcaConfidenceContribution[] = [];
  const hypotheses: RcaHypothesis[] = [];

  if (isCrashLoop) {
    const contribution = toContribution(
      "crashloop-config",
      72,
      [
        ...(signals.find((signal) => signal.id === crashLoopSignal)?.matched
          ? [{ signalId: crashLoopSignal, delta: 14, reason: "CrashLoopBackOff state detected" }]
          : []),
        ...(signals.find((signal) => signal.id === missingConfigSignal)?.matched
          ? [{ signalId: missingConfigSignal, delta: 10, reason: "Logs indicate missing config" }]
          : []),
        ...(signals.find((signal) => signal.id === dependencySignal)?.matched
          ? [{ signalId: dependencySignal, delta: 6, reason: "Dependency connectivity errors detected" }]
          : []),
      ],
      [
        ...(signals.find((signal) => signal.id === imagePullSignal)?.matched
          ? [{ signalId: imagePullSignal, delta: 18, reason: "Image pull failure is a stronger upstream blocker" }]
          : []),
      ],
    );
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "crashloop-config",
      title: "Application startup/configuration failure",
      confidence: contribution.final,
      summary:
        "Pod is in CrashLoopBackOff and startup/configuration or dependency initialization is failing.",
    });
  }

  if (hasProbeFailureSignals) {
    const contribution = toContribution(
      "probe-misconfiguration",
      70,
      [
        ...(signals.find((signal) => signal.id === probeFailureSignal)?.matched
          ? [{ signalId: probeFailureSignal, delta: 16, reason: "Probe failure events detected" }]
          : []),
        ...(signals.find((signal) => signal.id === crashLoopSignal)?.matched
          ? [{ signalId: crashLoopSignal, delta: 8, reason: "CrashLoop likely driven by failing probes" }]
          : []),
        ...(signals.find((signal) => signal.id === restartChurnSignal)?.matched
          ? [{ signalId: restartChurnSignal, delta: 6, reason: "Repeated restarts reinforce probe instability" }]
          : []),
      ],
      [
        ...(signals.find((signal) => signal.id === imagePullSignal)?.matched
          ? [{ signalId: imagePullSignal, delta: 10, reason: "Image pull failures can precede probe checks" }]
          : []),
      ],
    );
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "probe-misconfiguration",
      title: "Health probe configuration/timing issue",
      confidence: contribution.final,
      summary:
        "Health probes are likely misconfigured or too aggressive for startup timing, causing repeated restarts.",
    });
  }

  if (isImagePull) {
    const hasImageAuth =
      signals.find((signal) => signal.id === imageAuthSignal)?.matched === true;
    const hasImageNotFound =
      signals.find((signal) => signal.id === imageNotFoundSignal)?.matched === true;

    if (hasImageAuth) {
      const authContribution = toContribution(
        "image-pull-auth",
        80,
        [
          { signalId: imagePullSignal, delta: 10, reason: "Image pull waiting state detected" },
          { signalId: imageAuthSignal, delta: 12, reason: "Registry authorization failure signals found" },
        ],
      );
      confidenceBreakdown.push(authContribution);
      hypotheses.push({
        id: "image-pull-auth",
        title: "Registry authentication/authorization failure",
        confidence: authContribution.final,
        summary:
          "Image pull is failing because registry credentials or pull permissions are invalid.",
      });
    }

    if (hasImageNotFound) {
      const notFoundContribution = toContribution(
        "image-pull-not-found",
        78,
        [
          { signalId: imagePullSignal, delta: 10, reason: "Image pull waiting state detected" },
          { signalId: imageNotFoundSignal, delta: 10, reason: "Image tag/manifest not found signals found" },
        ],
      );
      confidenceBreakdown.push(notFoundContribution);
      hypotheses.push({
        id: "image-pull-not-found",
        title: "Image reference/tag not found",
        confidence: notFoundContribution.final,
        summary:
          "Image pull is failing because the referenced image tag or manifest does not exist in the registry.",
      });
    }

    const genericContribution = toContribution(
      "image-pull",
      74,
      [
        ...(signals.find((signal) => signal.id === imagePullSignal)?.matched
          ? [{ signalId: imagePullSignal, delta: 10, reason: "Image pull waiting state detected" }]
          : []),
      ],
      [
        ...(hasImageAuth
          ? [{ signalId: imageAuthSignal, delta: 6, reason: "Specific auth failure already identified" }]
          : []),
        ...(hasImageNotFound
          ? [{ signalId: imageNotFoundSignal, delta: 6, reason: "Specific image-not-found failure already identified" }]
          : []),
      ],
    );
    confidenceBreakdown.push(genericContribution);
    hypotheses.push({
      id: "image-pull",
      title: "Container image pull failure",
      confidence: genericContribution.final,
      summary:
        "Image pull is failing due to image reference, registry access, or pull policy issues.",
    });
  }

  if (isPending) {
    const hasInsufficientCapacity =
      signals.find((signal) => signal.id === insufficientSignal)?.matched === true;
    const hasSchedulingConstraints =
      signals.find((signal) => signal.id === taintSignal)?.matched === true;

    if (hasInsufficientCapacity) {
      const capacityContribution = toContribution(
        "pending-capacity",
        70,
        [
          { signalId: pendingSignal, delta: 8, reason: "Pod remains in Pending state" },
          { signalId: insufficientSignal, delta: 14, reason: "Insufficient resource capacity detected" },
        ],
      );
      confidenceBreakdown.push(capacityContribution);
      hypotheses.push({
        id: "pending-capacity",
        title: "Cluster resource capacity shortage",
        confidence: capacityContribution.final,
        summary:
          "Pod remains pending because cluster nodes do not currently have enough allocatable resources.",
      });
    }

    if (hasSchedulingConstraints) {
      const constraintsContribution = toContribution(
        "pending-constraints",
        68,
        [
          { signalId: pendingSignal, delta: 8, reason: "Pod remains in Pending state" },
          { signalId: taintSignal, delta: 12, reason: "Taint/affinity mismatch signals found" },
        ],
      );
      confidenceBreakdown.push(constraintsContribution);
      hypotheses.push({
        id: "pending-constraints",
        title: "Scheduling constraints (taints/affinity/tolerations)",
        confidence: constraintsContribution.final,
        summary:
          "Pod remains pending because scheduler constraints prevent placement on available nodes.",
      });
    }

    if (hasMountFailureSignals) {
      const mountContribution = toContribution(
        "pending-mount-config",
        76,
        [
          { signalId: pendingSignal, delta: 8, reason: "Pod remains in Pending state" },
          { signalId: mountFailureSignal, delta: 14, reason: "Volume mount/config dependency failure detected" },
        ],
      );
      confidenceBreakdown.push(mountContribution);
      hypotheses.push({
        id: "pending-mount-config",
        title: "Volume mount or ConfigMap/Secret dependency failure",
        confidence: mountContribution.final,
        summary:
          "Pod remains pending because required volume/config dependencies (ConfigMap/Secret/PVC) cannot be mounted or resolved.",
      });
    }

    const pendingContribution = toContribution(
      "pending-scheduling",
      62,
      [
        ...(signals.find((signal) => signal.id === pendingSignal)?.matched
          ? [{ signalId: pendingSignal, delta: 10, reason: "Pod remains in Pending state" }]
          : []),
      ],
      [
        ...(hasInsufficientCapacity
          ? [{ signalId: insufficientSignal, delta: 6, reason: "Specific capacity root cause identified" }]
          : []),
        ...(hasSchedulingConstraints
          ? [{ signalId: taintSignal, delta: 6, reason: "Specific scheduling-constraint root cause identified" }]
          : []),
      ],
    );
    confidenceBreakdown.push(pendingContribution);
    hypotheses.push({
      id: "pending-scheduling",
      title: "Scheduling constraints or capacity shortage",
      confidence: pendingContribution.final,
      summary:
        "Pod remains pending due to capacity pressure or scheduler placement constraints.",
    });
  }

  if (isOomKilled) {
    const contribution = toContribution("oomkilled", 74, [
      { signalId: oomSignal, delta: 14, reason: "OOM kill signal detected" },
      ...(signals.find((signal) => signal.id === warningSignal)?.matched
        ? [{ signalId: warningSignal, delta: 5, reason: "Warning events indicate sustained instability" }]
        : []),
    ]);
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "oomkilled",
      title: "Memory pressure / OOM kill",
      confidence: contribution.final,
      summary: "Container was OOMKilled; memory requests/limits likely need tuning.",
    });
  }

  if (hasDependencySignals) {
    const contribution = toContribution("dependency-config", 62, [
      { signalId: dependencySignal, delta: 12, reason: "Connectivity/config error patterns in logs" },
      ...(signals.find((signal) => signal.id === warningSignal)?.matched
        ? [{ signalId: warningSignal, delta: 4, reason: "Related warning events present" }]
        : []),
    ]);
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "dependency-config",
      title: "Downstream dependency connectivity/config issue",
      confidence: contribution.final,
      summary:
        "Logs suggest dependency endpoint, credential, or network path problems during startup/runtime.",
    });
  }

  const isHealthyRunning =
    statusPhase === "Running" &&
    !isCrashLoop &&
    !isImagePull &&
    !isPending &&
    !isOomKilled &&
    !hasDependencySignals &&
    !hasProbeFailureSignals &&
    !hasMountFailureSignals &&
    warningEvents.length === 0 &&
    totalRestarts < 3;

  if (isHealthyRunning) {
    const contribution = toContribution("healthy-running", 96, [
      { signalId: warningSignal, delta: 0, reason: "No warning events for this workload" },
      { signalId: restartChurnSignal, delta: 0, reason: "Restart churn remains low" },
    ]);
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "healthy-running",
      title: "No active incident detected (healthy workload)",
      confidence: contribution.final,
      summary:
        "No active incident detected for this resource. The pod is healthy and running normally; continue routine monitoring.",
    });
  }

  if (hypotheses.length === 0) {
    const contribution = toContribution("generic-investigation", 55, [], []);
    confidenceBreakdown.push(contribution);
    hypotheses.push({
      id: "generic-investigation",
      title: "General workload degradation",
      confidence: contribution.final,
      summary:
        "No strong signature detected yet. Correlate events, logs, and recent changes for root-cause isolation.",
    });
  }

  hypotheses.sort(
    (a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id),
  );
  confidenceBreakdown.sort(
    (a, b) => b.final - a.final || a.hypothesisId.localeCompare(b.hypothesisId),
  );
  const prioritizedSignals = signals
    .filter((signal) => signal.matched)
    .sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return (
        severityOrder[b.severity] - severityOrder[a.severity] ||
        a.id.localeCompare(b.id)
      );
    });

  const analysisNotes = [
    prioritizedSignals.length > 0
      ? `Detected ${prioritizedSignals.length} matched signal(s) from status/events/logs.`
      : "No strong signature signals detected.",
    `Heuristic scoring evaluated ${confidenceBreakdown.length} hypothesis candidate(s).`,
  ];

  return {
    probableRootCause: hypotheses[0].summary,
    hypotheses: hypotheses.slice(0, 3),
    signals: prioritizedSignals.slice(0, 10),
    confidenceBreakdown: confidenceBreakdown.slice(0, 5),
    analysisNotes,
  };
}

function hypothesisKeywords(hypothesis: RcaHypothesis): string[] {
  const id = hypothesis.id.toLowerCase();
  const title = hypothesis.title.toLowerCase();
  const summary = hypothesis.summary.toLowerCase();
  const keywords = new Set<string>();

  if (id.includes("image-pull")) {
    ["image", "pull", "manifest", "errimagepull", "imagepullbackoff", "unauthorized", "denied"].forEach((word) =>
      keywords.add(word),
    );
  }

  if (id.includes("pending-mount-config")) {
    ["failedmount", "mount", "volume", "configmap", "secret", "pvc"].forEach((word) =>
      keywords.add(word),
    );
  }

  if (id.includes("pending-capacity")) {
    ["insufficient", "cpu", "memory", "resource"].forEach((word) => keywords.add(word));
  }

  if (id.includes("pending-constraints")) {
    ["taint", "affinity", "toleration", "didn't match", "did not match"].forEach((word) =>
      keywords.add(word),
    );
  }

  if (id.includes("probe")) {
    ["probe", "liveness", "readiness", "startup", "unhealthy"].forEach((word) =>
      keywords.add(word),
    );
  }

  if (id.includes("crashloop")) {
    ["crashloop", "back-off", "restart"].forEach((word) => keywords.add(word));
  }

  if (id.includes("oom")) {
    ["oom", "out of memory", "memory"].forEach((word) => keywords.add(word));
  }

  if (id.includes("dependency")) {
    ["database", "connection refused", "dial tcp", "timeout", "dns", "credential"].forEach((word) =>
      keywords.add(word),
    );
  }

  [id, title, summary]
    .join(" ")
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 5)
    .forEach((word) => keywords.add(word));

  return Array.from(keywords);
}

function shortenLine(input: string, maxLen = 180): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen - 1)}...`;
}

function collectEventHighlights(events: SynthesisInputEvent[], keywords: string[], limit = 2): string[] {
  if (keywords.length === 0) return [];
  const lowered = keywords.map((keyword) => keyword.toLowerCase());

  return events
    .filter((event) => {
      const haystack = `${event.title} ${event.description}`.toLowerCase();
      return lowered.some((keyword) => haystack.includes(keyword));
    })
    .slice(0, limit)
    .map((event) => `${event.type.toUpperCase()}: ${event.title} - ${shortenLine(event.description, 160)}`);
}

function collectLogHighlights(logSnippet: string, keywords: string[], limit = 2): string[] {
  if (!logSnippet.trim() || keywords.length === 0) return [];
  const lowered = keywords.map((keyword) => keyword.toLowerCase());

  return logSnippet
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => lowered.some((keyword) => line.toLowerCase().includes(keyword)))
    .slice(0, limit)
    .map((line) => shortenLine(line, 160));
}

function synthesizeHypothesisEvidence(params: {
  initialHypotheses: RcaHypothesis[];
  finalHypotheses: RcaHypothesis[];
  signals: RcaSignal[];
  confidenceBreakdown: RcaConfidenceContribution[];
  events: SynthesisInputEvent[];
  logSnippet: string;
}): HypothesisSynthesisOutput {
  const topHypotheses = params.finalHypotheses.slice(0, 3);
  const initialIds = new Set(params.initialHypotheses.map((hypothesis) => hypothesis.id));
  const signalById = new Map(params.signals.map((signal) => [signal.id, signal]));
  const contributionById = new Map(
    params.confidenceBreakdown.map((entry) => [entry.hypothesisId, entry]),
  );

  const traceLines: string[] = [];
  const correlatedHighlights: string[] = [];

  topHypotheses.forEach((hypothesis, index) => {
    const contribution = contributionById.get(hypothesis.id);
    const boosts =
      contribution?.boosts
        .map((boost) => {
          if (boost.signalId.startsWith("targeted-")) {
            return `${boost.signalId} (+${boost.delta})`;
          }
          const signal = signalById.get(boost.signalId);
          if (!signal?.matched) return null;
          return `${boost.signalId} (+${boost.delta})`;
        })
        .filter((value): value is string => Boolean(value)) || [];
    const penalties =
      contribution?.penalties
        .map((penalty) => {
          if (penalty.signalId.startsWith("targeted-")) {
            return `${penalty.signalId} (-${penalty.delta})`;
          }
          const signal = signalById.get(penalty.signalId);
          if (!signal?.matched) return null;
          return `${penalty.signalId} (-${penalty.delta})`;
        })
        .filter((value): value is string => Boolean(value)) || [];

    const keywords = hypothesisKeywords(hypothesis);
    const eventHighlights = collectEventHighlights(params.events, keywords, 2);
    const logHighlights = collectLogHighlights(params.logSnippet, keywords, 2);
    const origin = initialIds.has(hypothesis.id) ? "initial" : "refined";

    traceLines.push(
      `${index + 1}. ${hypothesis.id} (${hypothesis.confidence}%) [${origin}]`,
      `   support: ${boosts.length > 0 ? boosts.join(", ") : "none"}`,
      `   conflicts: ${penalties.length > 0 ? penalties.join(", ") : "none"}`,
      `   events: ${eventHighlights.length > 0 ? eventHighlights.join(" | ") : "none"}`,
      `   logs: ${logHighlights.length > 0 ? logHighlights.join(" | ") : "none"}`,
    );

    [...eventHighlights, ...logHighlights].forEach((line) => correlatedHighlights.push(line));
  });

  const primary = topHypotheses[0];
  const secondary = topHypotheses[1];
  const confidenceGap = primary && secondary ? primary.confidence - secondary.confidence : null;
  const summary = primary
    ? `Primary conclusion: ${primary.summary} (${primary.confidence}%).${
        secondary && confidenceGap !== null && confidenceGap <= 8
          ? ` Secondary competing hypothesis: ${secondary.title} (${secondary.confidence}%).`
          : ""
      }`
    : "Primary conclusion: insufficient evidence to rank a high-confidence hypothesis.";

  return {
    summary,
    trace:
      traceLines.join("\n") ||
      "No hypothesis trace available for this diagnosis.",
    highlights:
      Array.from(new Set(correlatedHighlights)).slice(0, 6).join("\n") ||
      "No correlated event/log highlights matched the top hypotheses.",
    note: `Hypothesis-driven synthesis completed across ${topHypotheses.length} ranked candidate(s).`,
  };
}

function extractMissingDependencyRefs(events: SynthesisInputEvent[]) {
  const refs: Array<{ kind: "secret" | "configmap"; name: string }> = [];
  const seen = new Set<string>();
  const patterns = [
    { kind: "secret" as const, regex: /secret\s+"([^"]+)"\s+not found/gi },
    { kind: "configmap" as const, regex: /configmap\s+"([^"]+)"\s+not found/gi },
  ];

  events.forEach((event) => {
    const text = `${event.title} ${event.description}`;
    patterns.forEach(({ kind, regex }) => {
      let match: RegExpExecArray | null = regex.exec(text);
      while (match) {
        const name = (match[1] || "").trim();
        const key = `${kind}:${name}`;
        if (name && !seen.has(key)) {
          seen.add(key);
          refs.push({ kind, name });
        }
        match = regex.exec(text);
      }
      regex.lastIndex = 0;
    });
  });

  return refs;
}

function extractPodDependencyRefs(resource: any) {
  const volumes = Array.isArray(resource?.spec?.volumes) ? resource.spec.volumes : [];
  const refs = new Set<string>();

  volumes.forEach((volume: any) => {
    if (volume?.secret?.secretName) {
      refs.add(`secret:${String(volume.secret.secretName).trim()}`);
    }
    if (volume?.configMap?.name) {
      refs.add(`configmap:${String(volume.configMap.name).trim()}`);
    }
  });

  return refs;
}

function runTargetedEvidenceIteration(params: {
  hypotheses: RcaHypothesis[];
  resource: any;
  events: SynthesisInputEvent[];
}): TargetedIterationOutput {
  const topHypothesis = params.hypotheses[0];
  if (!topHypothesis) {
    return { evidenceItems: [], analysisNotes: [], adjustments: [] };
  }

  const steps: string[] = [];
  const findings: string[] = [];
  const analysisNotes: string[] = [];
  const adjustments: TargetedAdjustment[] = [];

  const eventText = params.events
    .map((event) => `${event.title} ${event.description}`.toLowerCase())
    .join("\n");

  if (topHypothesis.id === "pending-mount-config") {
    const missingRefs = extractMissingDependencyRefs(params.events);
    const podRefs = extractPodDependencyRefs(params.resource);
    const correlatedRefs = missingRefs.filter((ref) =>
      podRefs.has(`${ref.kind}:${ref.name}`),
    );

    steps.push(
      "1. Inspect mount-related warnings for missing ConfigMap/Secret references.",
      "2. Correlate missing dependency names against Pod volume declarations.",
      "3. Re-rank mount/config hypothesis using matched dependency evidence.",
    );

    findings.push(
      `Missing dependency mentions: ${
        missingRefs.length > 0
          ? missingRefs.map((ref) => `${ref.kind}:${ref.name}`).join(", ")
          : "none"
      }`,
      `Pod volume references: ${
        podRefs.size > 0 ? Array.from(podRefs).join(", ") : "none"
      }`,
      `Correlated dependency links: ${
        correlatedRefs.length > 0
          ? correlatedRefs.map((ref) => `${ref.kind}:${ref.name}`).join(", ")
          : "none"
      }`,
    );

    if (correlatedRefs.length > 0) {
      adjustments.push({
        hypothesisId: "pending-mount-config",
        delta: 8,
        reason: "Iteration confirmed missing dependency is referenced by Pod volume configuration",
      });
      analysisNotes.push(
        "Iteration 1 reinforced pending-mount-config via event + pod volume correlation.",
      );
    } else if (missingRefs.length > 0) {
      adjustments.push({
        hypothesisId: "pending-mount-config",
        delta: 4,
        reason: "Iteration found missing dependency events but could not confirm Pod volume reference",
      });
      analysisNotes.push(
        "Iteration 1 partially reinforced pending-mount-config from mount failure events.",
      );
    } else {
      adjustments.push({
        hypothesisId: "pending-mount-config",
        delta: -6,
        reason: "Iteration did not find concrete mount/config dependency evidence",
      });
      analysisNotes.push(
        "Iteration 1 weakened pending-mount-config due to missing corroborating evidence.",
      );
    }
  } else if (topHypothesis.id === "healthy-running") {
    steps.push(
      "1. Confirm workload phase is Running with low restart churn.",
      "2. Confirm warning events are absent for the selected resource.",
      "3. Mark as no active incident and provide monitoring guidance.",
    );
    findings.push(
      "No active incident signature detected from status/events/logs.",
      "Workload appears healthy in current observation window.",
    );
    analysisNotes.push(
      "Iteration 1 confirmed healthy-running state; no immediate remediation required.",
    );
  } else if (topHypothesis.id.startsWith("image-pull")) {
    steps.push(
      "1. Validate image pull waiting reason in container status.",
      "2. Correlate registry/manifest error text from events.",
      "3. Re-rank image-pull hypotheses by specificity (auth vs not-found).",
    );

    const hasImageNotFound =
      eventText.includes("manifest unknown") ||
      (eventText.includes("not found") &&
        (eventText.includes("image") || eventText.includes("manifest") || eventText.includes("pull")));
    const hasAuthError =
      eventText.includes("pull access denied") || eventText.includes("unauthorized");

    findings.push(
      `Image not found evidence: ${hasImageNotFound ? "present" : "absent"}`,
      `Registry auth evidence: ${hasAuthError ? "present" : "absent"}`,
    );

    if (hasImageNotFound || hasAuthError) {
      adjustments.push({
        hypothesisId: topHypothesis.id,
        delta: 6,
        reason: "Iteration corroborated image pull failure subtype from events",
      });
      analysisNotes.push(
        "Iteration 1 reinforced image-pull diagnosis with subtype-specific event evidence.",
      );
    }
  } else if (topHypothesis.id === "probe-misconfiguration") {
    steps.push(
      "1. Verify probe failure warnings in events.",
      "2. Correlate restart churn with probe instability.",
      "3. Re-rank probe hypothesis with combined state + event support.",
    );

    const hasProbeEvent =
      eventText.includes("liveness probe failed") ||
      eventText.includes("readiness probe failed") ||
      eventText.includes("startup probe failed");
    const hasRestarts = Number(params.resource?.status?.containerStatuses?.[0]?.restartCount || 0) >= 5;

    findings.push(
      `Probe failure event evidence: ${hasProbeEvent ? "present" : "absent"}`,
      `Restart churn evidence: ${hasRestarts ? "present" : "absent"}`,
    );

    if (hasProbeEvent && hasRestarts) {
      adjustments.push({
        hypothesisId: "probe-misconfiguration",
        delta: 6,
        reason: "Iteration correlated probe failures with restart churn",
      });
      analysisNotes.push(
        "Iteration 1 reinforced probe-misconfiguration using probe event + restart correlation.",
      );
    }
  } else if (topHypothesis.id.startsWith("pending-")) {
    steps.push(
      "1. Review scheduler warnings for capacity or constraint clues.",
      "2. Correlate Pending phase with scheduling evidence.",
      "3. Re-rank scheduling hypotheses by strongest matched scheduler signal.",
    );

    const hasInsufficient = eventText.includes("insufficient");
    const hasConstraints = eventText.includes("taint") || eventText.includes("didn't match");

    findings.push(
      `Insufficient-capacity evidence: ${hasInsufficient ? "present" : "absent"}`,
      `Constraint/taint evidence: ${hasConstraints ? "present" : "absent"}`,
    );
  } else {
    steps.push(
      "1. Start with the top ranked hypothesis from initial scoring.",
      "2. Correlate events and logs specific to this hypothesis.",
      "3. Re-score hypothesis confidence based on corroborating evidence.",
    );
    findings.push(
      "No specialized targeted workflow yet; generic synthesis path applied.",
    );
  }

  const evidenceItems: RcaDiagnoseResponse["evidence"] = [
    {
      source: "analysis",
      title: "Targeted Verification Steps",
      detail: steps.join("\n"),
    },
    {
      source: "analysis",
      title: "Iteration 1 Findings",
      detail: findings.join("\n"),
    },
  ];

  return { evidenceItems, analysisNotes, adjustments };
}

function applyHypothesisAdjustments(
  hypotheses: RcaHypothesis[],
  adjustments: TargetedAdjustment[],
): RcaHypothesis[] {
  if (adjustments.length === 0) return hypotheses;
  const adjustmentMap = new Map<string, number>();
  adjustments.forEach((adjustment) => {
    adjustmentMap.set(
      adjustment.hypothesisId,
      (adjustmentMap.get(adjustment.hypothesisId) || 0) + adjustment.delta,
    );
  });

  return hypotheses
    .map((hypothesis) => ({
      ...hypothesis,
      confidence: clampConfidence(
        hypothesis.confidence + (adjustmentMap.get(hypothesis.id) || 0),
        hypothesis.confidence,
      ),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, 3);
}

function applyConfidenceAdjustments(
  breakdown: RcaConfidenceContribution[],
  adjustments: TargetedAdjustment[],
): RcaConfidenceContribution[] {
  if (adjustments.length === 0) return breakdown;
  const adjustmentMap = new Map<string, TargetedAdjustment>();
  adjustments.forEach((adjustment) => {
    const existing = adjustmentMap.get(adjustment.hypothesisId);
    if (existing) {
      existing.delta += adjustment.delta;
      existing.reason = `${existing.reason}; ${adjustment.reason}`;
    } else {
      adjustmentMap.set(adjustment.hypothesisId, { ...adjustment });
    }
  });

  return breakdown
    .map((entry) => {
      const adjustment = adjustmentMap.get(entry.hypothesisId);
      if (!adjustment) return entry;

      if (adjustment.delta >= 0) {
        return {
          ...entry,
          boosts: [
            ...entry.boosts,
            {
              signalId: "targeted-iteration",
              delta: adjustment.delta,
              reason: adjustment.reason,
            },
          ],
          final: clampConfidence(entry.final + adjustment.delta, entry.final),
        };
      }

      return {
        ...entry,
        penalties: [
          ...entry.penalties,
          {
            signalId: "targeted-iteration",
            delta: Math.abs(adjustment.delta),
            reason: adjustment.reason,
          },
        ],
        final: clampConfidence(entry.final + adjustment.delta, entry.final),
      };
    })
    .sort((a, b) => b.final - a.final || a.hypothesisId.localeCompare(b.hypothesisId))
    .slice(0, 5);
}

function mergeHypotheses(primary: RcaHypothesis[], secondary: RcaHypothesis[]): RcaHypothesis[] {
  const seen = new Set<string>();
  const merged: RcaHypothesis[] = [];

  [...primary, ...secondary].forEach((item) => {
    const key = `${item.id}:${item.title}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });

  return merged.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function selectRecommendations(skills: Awaited<ReturnType<typeof listSkills>>, hypotheses: RcaHypothesis[]) {
  const hypothesisText = hypotheses
    .map((hypothesis) => `${hypothesis.id} ${hypothesis.title} ${hypothesis.summary}`.toLowerCase())
    .join(" ");

  return skills
    .filter((skill) => {
      if (skill.tags.includes("rca")) return true;
      return skill.tags.some((tag) => hypothesisText.includes(tag.toLowerCase()));
    })
    .slice(0, 3);
}

export async function diagnoseResource(
  request: RcaDiagnoseRequest,
): Promise<RcaDiagnoseResponse> {
  const namespace = request.resource.namespace || "default";
  const resolvedScope = resolveScope({
    scopeId: request.scopeId,
    clusterContext: request.clusterContext || request.context,
    workspaceId: request.workspaceId,
    tenantId: request.tenantId,
    integrationProfileId: request.integrationProfileId,
  });
  const clusterContext = resolvedScope.clusterContext;

  const described = await describeResource({
    resourceType: request.resource.kind,
    name: request.resource.name,
    namespace,
    context: clusterContext,
  });

  const [eventsPayload, metrics, skills] = await Promise.all([
    getEvents({
      namespace,
      context: clusterContext,
      resourceType: request.resource.kind,
      resourceName: request.resource.name,
      limit: 20,
    }),
    getClusterMetrics({ context: clusterContext }),
    listSkills(),
  ]);

  let logSnippet = "";
  if ((request.resource.kind || "").toLowerCase() === "pod") {
    try {
      const logs = await getPodLogs({
        podName: request.resource.name,
        namespace,
        context: clusterContext,
        lines: 80,
      });
      logSnippet = logs.logs.slice(0, 2400);
    } catch {
      // Best effort logs, continue without failing diagnosis.
    }
  }

  const heuristic = buildHeuristicHypotheses(
    described.resource,
    eventsPayload.events,
    logSnippet,
  );

  const metricsSummary = `CPU ${metrics.cpu.percentage}% | Memory ${metrics.memory.percentage}% | Pods ${metrics.podCount} | Nodes ${metrics.nodeCount}`;

  const agenticMeta: NonNullable<RcaDiagnoseResponse["agentic"]> = {
    attempted: request.useAgentic !== false,
    used: false,
  };

  let probableRootCause = heuristic.probableRootCause;
  let hypotheses = heuristic.hypotheses;
  let analysisMode: RcaDiagnoseResponse["analysisMode"] = "heuristic";
  let agenticEvidence: string | undefined;
  const analysisNotes = [...heuristic.analysisNotes];

  if (request.useAgentic !== false) {
    const { output, error } = await runAgenticRcaAnalysis({
      resource: request.resource,
      clusterContext,
      statusPhase: described.resource?.status?.phase,
      events: eventsPayload.events,
      metricsSummary,
      logSnippet,
      modelPreferences: request.modelPreferences,
    });

    if (output) {
      hypotheses = mergeHypotheses(output.hypotheses, heuristic.hypotheses);
      probableRootCause = output.probableRootCause;
      analysisMode = "agentic_hybrid";
      agenticMeta.used = true;
      agenticEvidence = output.analysisNote;
      analysisNotes.push("Agentic analysis enriched heuristic diagnosis.");
      if (output.analysisNote) {
        analysisNotes.push(output.analysisNote);
      }
    } else {
      agenticMeta.fallbackReason = error || "Agent analysis unavailable";
      analysisNotes.push(`Heuristic fallback reason: ${agenticMeta.fallbackReason}`);
    }
  }

  const targetedIteration = runTargetedEvidenceIteration({
    hypotheses,
    resource: described.resource,
    events: eventsPayload.events,
  });
  if (targetedIteration.adjustments.length > 0) {
    hypotheses = applyHypothesisAdjustments(hypotheses, targetedIteration.adjustments);
    heuristic.confidenceBreakdown = applyConfidenceAdjustments(
      heuristic.confidenceBreakdown,
      targetedIteration.adjustments,
    );
  }
  analysisNotes.push(...targetedIteration.analysisNotes);

  if (hypotheses.length > 0) probableRootCause = hypotheses[0].summary;

  const synthesis = synthesizeHypothesisEvidence({
    initialHypotheses: heuristic.hypotheses,
    finalHypotheses: hypotheses,
    signals: heuristic.signals,
    confidenceBreakdown: heuristic.confidenceBreakdown,
    events: eventsPayload.events,
    logSnippet,
  });
  analysisNotes.push(synthesis.note);

  const diagnosisId = uuidv4();
  const recommendations = selectRecommendations(skills, hypotheses);
  const signalSummary = (heuristic.signals || [])
    .slice(0, 5)
    .map(
      (signal) =>
        `${signal.severity.toUpperCase()} ${signal.category}: ${signal.detail}`,
    )
    .join("\n");

  const confidenceDetail = (heuristic.confidenceBreakdown || [])
    .slice(0, 3)
    .map((entry) => {
      const boostText = entry.boosts
        .map((boost) => `+${boost.delta} ${boost.reason}`)
        .join("; ");
      const penaltyText = entry.penalties
        .map((penalty) => `-${penalty.delta} ${penalty.reason}`)
        .join("; ");
      return `${entry.hypothesisId}: base=${entry.base}; ${boostText || "no boosts"}${penaltyText ? `; ${penaltyText}` : ""}; final=${entry.final}`;
    })
    .join("\n");

  const sourceDetail =
    resolvedScope.connectors.length > 0
      ? resolvedScope.connectors
          .map(
            (connector) =>
              `${connector.kind}:${connector.id}${connector.metadata?.mode ? ` (${connector.metadata.mode})` : ""}`,
          )
          .join("\n")
      : "No evidence connectors resolved for this scope.";

  const response: RcaDiagnoseResponse = {
    diagnosisId,
    resource: request.resource,
    probableRootCause,
    hypotheses,
    evidence: [
      ...targetedIteration.evidenceItems,
      {
        source: "analysis",
        title: "Hypothesis Synthesis",
        detail: synthesis.summary,
      },
      {
        source: "analysis",
        title: "Hypothesis Evidence Trace",
        detail: synthesis.trace,
      },
      {
        source: "analysis",
        title: "Correlated Evidence Highlights",
        detail: synthesis.highlights,
      },
      {
        source: "analysis",
        title: "Detected Signals",
        detail: signalSummary || "No high-confidence matched signals.",
      },
      {
        source: "analysis",
        title: "Available Evidence Sources",
        detail: sourceDetail,
      },
      {
        source: "analysis",
        title: "Confidence Model",
        detail: confidenceDetail || "No confidence breakdown available.",
      },
      {
        source: "resource",
        title: "Resource Status",
        detail: JSON.stringify(
          {
            phase: described.resource?.status?.phase,
            conditions: described.resource?.status?.conditions,
          },
          null,
          2,
        ).slice(0, 1600),
      },
      {
        source: "event",
        title: "Recent Events",
        detail:
          eventsPayload.events
            .slice(0, 6)
            .map(
              (event) =>
                `${event.type.toUpperCase()}: ${event.title} - ${event.description}`,
            )
            .join("\n") || "No recent events found",
      },
      {
        source: "metric",
        title: "Cluster Pressure",
        detail: metricsSummary,
      },
      {
        source: "log",
        title: "Log Snippet",
        detail: logSnippet || "Logs unavailable for this resource type or access denied.",
      },
      {
        source: "analysis",
        title: "RCA Analysis Mode",
        detail: agenticMeta.used
          ? `Agent-assisted + heuristic analysis used. ${agenticEvidence || ""}`.trim()
          : `Heuristic analysis used. ${agenticMeta.fallbackReason || ""}`.trim(),
      },
    ],
    recommendations,
    analysisMode,
    signals: heuristic.signals,
    confidenceBreakdown: heuristic.confidenceBreakdown,
    analysisNotes,
    agentic: agenticMeta,
    generatedAt: Date.now(),
  };

  diagnosisStore.set(diagnosisId, response);
  return response;
}

export function getDiagnosisById(diagnosisId: string): RcaDiagnoseResponse | null {
  return diagnosisStore.get(diagnosisId) || null;
}

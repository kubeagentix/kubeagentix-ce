import { SkillSummary } from "./skills";

export interface RcaResourceRef {
  kind: string;
  name: string;
  namespace: string;
}

export interface RcaDiagnoseRequest {
  resource: RcaResourceRef;
  context?: string;
  useAgentic?: boolean;
  scopeId?: string;
  clusterContext?: string;
  workingNamespace?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  modelPreferences?: {
    providerId?: string;
    model?: string;
    apiKey?: string;
    authToken?: string;
  };
}

export interface RcaEvidenceItem {
  source: "resource" | "event" | "log" | "metric" | "analysis";
  title: string;
  detail: string;
}

export interface RcaHypothesis {
  id: string;
  title: string;
  confidence: number;
  summary: string;
}

export interface RcaSignal {
  id: string;
  category:
    | "crashloop"
    | "image_pull"
    | "scheduling"
    | "memory"
    | "dependency"
    | "events"
    | "resource_state";
  matched: boolean;
  detail: string;
  source: "status" | "event" | "log" | "metric";
  severity: "low" | "medium" | "high";
}

export interface RcaConfidenceContribution {
  hypothesisId: string;
  base: number;
  boosts: Array<{
    signalId: string;
    delta: number;
    reason: string;
  }>;
  penalties: Array<{
    signalId: string;
    delta: number;
    reason: string;
  }>;
  final: number;
}

export interface RcaDiagnoseResponse {
  diagnosisId: string;
  resource: RcaResourceRef;
  probableRootCause: string;
  hypotheses: RcaHypothesis[];
  evidence: RcaEvidenceItem[];
  recommendations: SkillSummary[];
  analysisMode: "heuristic" | "agentic_hybrid";
  signals?: RcaSignal[];
  confidenceBreakdown?: RcaConfidenceContribution[];
  analysisNotes?: string[];
  agentic?: {
    attempted: boolean;
    used: boolean;
    fallbackReason?: string;
    providerId?: string;
    providerName?: string;
    model?: string;
    attempt?: string;
  };
  generatedAt: number;
}

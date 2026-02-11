/**
 * Incident and Analysis Types
 */

export type IncidentSeverity = "critical" | "warning" | "info";

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: "open" | "investigating" | "resolved";
  createdAt: number;
  updatedAt: number;
  affectedServices: string[];
  affectedResources: Array<{
    kind: string;
    name: string;
    namespace: string;
  }>;
  detectedBy: string; // e.g., "AlertManager", "Agent", "Manual"
}

export interface IncidentAnalysis {
  incidentId: string;
  rootCause: string;
  rootCauseConfidence: number; // 0-100
  timeline: AnalysisTimelineEvent[];
  impacts: string[];
  recommendations: Recommendation[];
  affectedMetrics: string[];
  correlations: MetricCorrelation[];
}

export interface AnalysisTimelineEvent {
  timestamp: number;
  title: string;
  description?: string;
  type: "detection" | "escalation" | "analysis" | "action";
  status: "complete" | "pending" | "failed";
}

export interface Recommendation {
  id: string;
  action: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  estimatedImpact: string;
  commands?: string[];
  requiresApproval: boolean;
}

export interface MetricCorrelation {
  metric1: string;
  metric2: string;
  correlationCoefficient: number; // -1 to 1
  strength: "very_high" | "high" | "medium" | "low";
}

export interface IncidentAlert {
  id: string;
  incidentId: string;
  type: "alert" | "escalation" | "update";
  message: string;
  severity: IncidentSeverity;
  timestamp: number;
  source: string;
}

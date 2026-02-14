import type { RcaResourceRef } from "./rca";

export type IncidentSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "warning"
  | "info";

export type IncidentStatus =
  | "new"
  | "triage"
  | "investigating"
  | "mitigated"
  | "monitoring"
  | "resolved"
  | "postmortem";

export type IncidentSource = "manual" | "quickdx" | "webhook" | "jira" | "slack" | "system";

export type IncidentLayer =
  | "edge"
  | "app"
  | "dependency"
  | "platform"
  | "infra"
  | "network"
  | "security"
  | "rbac"
  | "observability";

export interface IncidentEntity {
  id: string;
  layer: IncidentLayer;
  kind: string;
  name: string;
  namespace?: string;
  service?: string;
  metadata?: Record<string, string>;
}

export type IncidentEdgeRelationship =
  | "ingress_routes_to_service"
  | "service_targets_pod"
  | "service_resolves_endpoint"
  | "workload_owns_pod"
  | "pod_scheduled_on_node"
  | "networkpolicy_selects_pod"
  | "rolebinding_targets_serviceaccount"
  | "clusterrolebinding_targets_serviceaccount"
  | "observability_detects_entity";

export interface IncidentGraphEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationship: IncidentEdgeRelationship;
  layer: IncidentLayer;
  confidence: number;
  rationale: string;
  metadata?: Record<string, string>;
}

export type IncidentTimelineEventType =
  | "intake"
  | "triage"
  | "analysis"
  | "action"
  | "sync"
  | "status"
  | "diagnosis"
  | "note";

export interface IncidentTimelineEvent {
  id: string;
  timestamp: number;
  type: IncidentTimelineEventType;
  actor: string;
  source: IncidentSource | "api";
  message: string;
  payload?: Record<string, unknown>;
  correlationKeys?: string[];
}

export type IncidentActionType = "command" | "skill" | "manual";
export type IncidentActionRisk = "critical" | "high" | "medium" | "low";
export type IncidentActionApprovalState = "pending" | "approved" | "rejected" | "executed";

export interface IncidentActionExecution {
  success: boolean;
  startedAt: number;
  finishedAt: number;
  output?: string;
  error?: string;
  commandExitCode?: number;
  dryRun?: boolean;
}

export interface IncidentAction {
  id: string;
  title: string;
  description?: string;
  type: IncidentActionType;
  risk: IncidentActionRisk;
  requiresApproval: boolean;
  approvalState: IncidentActionApprovalState;
  proposedBy: string;
  command?: string;
  skillId?: string;
  skillInput?: Record<string, string>;
  dryRun?: boolean;
  approvedBy?: string;
  approvedAt?: number;
  rejectedBy?: string;
  rejectedAt?: number;
  rejectionReason?: string;
  executedBy?: string;
  executedAt?: number;
  execution?: IncidentActionExecution;
  createdAt: number;
  updatedAt: number;
}

export type IncidentExternalSystem = "jira" | "slack";
export type IncidentExternalSyncStatus = "pending" | "success" | "failed";

export interface IncidentExternalRef {
  system: IncidentExternalSystem;
  externalId: string;
  url?: string;
  syncStatus: IncidentExternalSyncStatus;
  lastSyncedAt?: number;
  metadata?: Record<string, string>;
}

export interface IncidentCorrelation {
  signalId: string;
  entityIds: string[];
  confidence: number;
  rationale: string;
}

export interface IncidentDiagnosisRef {
  diagnosisId: string;
  resource: RcaResourceRef;
  probableRootCause: string;
  attachedAt: number;
  attachedBy: string;
}

export interface IncidentCase {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  owner?: string;
  services: string[];
  entities: IncidentEntity[];
  graphEdges: IncidentGraphEdge[];
  source: IncidentSource;
  externalRefs: IncidentExternalRef[];
  correlations: IncidentCorrelation[];
  diagnoses: IncidentDiagnosisRef[];
  actions: IncidentAction[];
  timeline: IncidentTimelineEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface IncidentSummary {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  owner?: string;
  source: IncidentSource;
  services: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateIncidentRequest {
  title: string;
  description?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  owner?: string;
  services?: string[];
  entities?: IncidentEntity[];
  source?: IncidentSource;
  actor?: string;
  externalRefs?: IncidentExternalRef[];
  correlations?: IncidentCorrelation[];
}

export interface UpdateIncidentRequest {
  title?: string;
  description?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  owner?: string;
  services?: string[];
  actor?: string;
}

export interface AttachIncidentDiagnosisRequest {
  diagnosisId: string;
  attachedBy?: string;
  note?: string;
}

export interface CreateIncidentActionRequest {
  title: string;
  description?: string;
  type: IncidentActionType;
  risk?: IncidentActionRisk;
  requiresApproval?: boolean;
  proposedBy?: string;
  command?: string;
  skillId?: string;
  skillInput?: Record<string, string>;
  dryRun?: boolean;
}

export interface ApproveIncidentActionRequest {
  approved?: boolean;
  actor?: string;
  reason?: string;
}

export interface ExecuteIncidentActionRequest {
  actor?: string;
  dryRun?: boolean;
  context?: string;
  namespace?: string;
}

export interface ForceIncidentSyncRequest {
  actor?: string;
  externalId?: string;
  url?: string;
  metadata?: Record<string, string>;
}

export interface IncidentWebhookRequest {
  incidentId?: string;
  source?: IncidentSource | IncidentExternalSystem;
  externalId?: string;
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  owner?: string;
  services?: string[];
  actor?: string;
  url?: string;
  eventId?: string;
  updatedAt?: number;
  metadata?: Record<string, string>;
}

export interface InvestigateIncidentRequest {
  actor?: string;
  clusterContext?: string;
  namespace?: string;
  maxEntities?: number;
  includeObservability?: boolean;
}

export interface InvestigateIncidentResponse {
  incident: IncidentCase;
  summary: {
    entityCount: number;
    edgeCount: number;
    correlationCount: number;
    warningCount: number;
  };
  warnings: string[];
}

export interface ListIncidentsQuery {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  source?: IncidentSource;
  owner?: string;
  service?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ListIncidentsResponse {
  items: IncidentSummary[];
  total: number;
}

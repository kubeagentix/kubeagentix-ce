import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type {
  ApproveIncidentActionRequest,
  AttachIncidentDiagnosisRequest,
  CreateIncidentActionRequest,
  CreateIncidentRequest,
  ExecuteIncidentActionRequest,
  ForceIncidentSyncRequest,
  IncidentAction,
  IncidentCase,
  IncidentCorrelation,
  IncidentEntity,
  IncidentExternalRef,
  IncidentGraphEdge,
  IncidentExternalSystem,
  IncidentSource,
  IncidentStatus,
  IncidentSummary,
  IncidentTimelineEvent,
  IncidentWebhookRequest,
  InvestigateIncidentRequest,
  InvestigateIncidentResponse,
  ListIncidentsQuery,
  ListIncidentsResponse,
  UpdateIncidentRequest,
} from "@shared/incident";
import { getDiagnosisById } from "./rca";
import { executeSkill } from "./skills";
import { getCommandBroker } from "../commands/broker";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data", "incidents");
const INDEX_FILE = "index.json";
const DEFAULT_SYNC_TIMEOUT_MS = 8000;
const MAX_GRAPH_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_GRAPH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_GRAPH_ENTITIES = 180;

const ALLOWED_STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  new: ["triage", "investigating", "resolved"],
  triage: ["investigating", "resolved"],
  investigating: ["mitigated", "monitoring", "resolved"],
  mitigated: ["monitoring", "investigating", "resolved"],
  monitoring: ["resolved", "investigating"],
  resolved: ["postmortem"],
  postmortem: [],
};

export class IncidentServiceError extends Error {
  code:
    | "INCIDENT_NOT_FOUND"
    | "INCIDENT_VALIDATION_ERROR"
    | "INCIDENT_INVALID_TRANSITION"
    | "INCIDENT_DIAGNOSIS_NOT_FOUND"
    | "INCIDENT_ACTION_NOT_FOUND"
    | "INCIDENT_ACTION_NOT_APPROVED"
    | "INCIDENT_ACTION_INVALID"
    | "INCIDENT_SYNC_FAILED"
    | "INCIDENT_STORE_ERROR";

  constructor(code: IncidentServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

interface IncidentStoreIndex {
  incidents: IncidentSummary[];
}

interface IncidentServiceOptions {
  dataDir?: string;
  now?: () => number;
  diagnosisLookup?: typeof getDiagnosisById;
  commandExecute?: ReturnType<typeof getCommandBroker>["execute"];
  skillExecute?: typeof executeSkill;
  externalSyncAdapters?: Partial<Record<IncidentExternalSystem, IncidentExternalSyncAdapter>>;
}

type IncidentExternalSyncMode = "mock" | "webhook" | "disabled";

interface IncidentExternalSyncAdapterInput {
  system: IncidentExternalSystem;
  incident: IncidentCase;
  payload: ForceIncidentSyncRequest;
  existingRef?: IncidentExternalRef;
}

interface IncidentExternalSyncResult {
  externalId: string;
  url?: string;
  metadata?: Record<string, string>;
}

type IncidentExternalSyncAdapter = (
  input: IncidentExternalSyncAdapterInput,
) => Promise<IncidentExternalSyncResult>;

function normalizeServices(input?: string[]): string[] {
  return Array.from(new Set((input || []).map((item) => item.trim()).filter(Boolean))).sort();
}

function buildSummary(incident: IncidentCase): IncidentSummary {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    owner: incident.owner,
    source: incident.source,
    services: incident.services,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

function includesCaseInsensitive(target: string, needle?: string): boolean {
  if (!needle) return true;
  return target.toLowerCase().includes(needle.toLowerCase());
}

function resolveSyncMode(system: IncidentExternalSystem): IncidentExternalSyncMode {
  const key = system === "jira" ? "INCIDENT_JIRA_SYNC_MODE" : "INCIDENT_SLACK_SYNC_MODE";
  const rawValue = (process.env[key] || "mock").trim().toLowerCase();
  if (rawValue === "mock" || rawValue === "webhook" || rawValue === "disabled") {
    return rawValue;
  }
  return "mock";
}

function getWebhookUrl(system: IncidentExternalSystem): string | undefined {
  const key = system === "jira" ? "INCIDENT_JIRA_WEBHOOK_URL" : "INCIDENT_SLACK_WEBHOOK_URL";
  const value = process.env[key]?.trim();
  return value || undefined;
}

function getExternalBaseUrl(system: IncidentExternalSystem): string | undefined {
  const key = system === "jira" ? "INCIDENT_JIRA_BASE_URL" : "INCIDENT_SLACK_BASE_URL";
  const value = process.env[key]?.trim();
  return value || undefined;
}

function toTimestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMetadata(
  ...maps: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (value === undefined || value === null) continue;
      merged[key] = String(value);
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function defaultExternalId(system: IncidentExternalSystem, incident: IncidentCase): string {
  const suffix = incident.id.replace(/^inc-/, "").slice(0, 8).toUpperCase();
  if (system === "jira") return `JIRA-${suffix}`;
  return `slack-${suffix.toLowerCase()}`;
}

function parseTimeoutMs(): number {
  const parsed = Number(process.env.INCIDENT_SYNC_TIMEOUT_MS || DEFAULT_SYNC_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNC_TIMEOUT_MS;
  return Math.min(parsed, 60_000);
}

function toRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null) continue;
    record[key] = String(item);
  }
  return record;
}

function labelsMatch(selector: Record<string, string>, labels: Record<string, string>): boolean {
  const selectorEntries = Object.entries(selector || {});
  if (selectorEntries.length === 0) return false;
  return selectorEntries.every(([key, value]) => labels[key] === value);
}

function buildEntityId(kind: string, namespace: string | undefined, name: string): string {
  return `${kind.toLowerCase()}/${namespace || "_cluster"}/${name}`;
}

function buildDefaultExternalSyncAdapters(
  now: () => number,
): Record<IncidentExternalSystem, IncidentExternalSyncAdapter> {
  const webhookAdapter =
    (system: IncidentExternalSystem): IncidentExternalSyncAdapter =>
    async ({ incident, payload, existingRef }) => {
      const mode = resolveSyncMode(system);
      if (mode === "disabled") {
        throw new Error(`${system.toUpperCase()} sync is disabled by environment`);
      }

      const fallbackExternalId =
        payload.externalId?.trim() || existingRef?.externalId || defaultExternalId(system, incident);

      if (mode === "mock") {
        const baseUrl = getExternalBaseUrl(system);
        return {
          externalId: fallbackExternalId,
          url: payload.url || existingRef?.url || (baseUrl ? `${baseUrl}/${fallbackExternalId}` : undefined),
          metadata: toMetadata(payload.metadata, {
            mode: "mock",
            lastMockSyncAt: String(now()),
          }),
        };
      }

      const webhookUrl = getWebhookUrl(system);
      if (!webhookUrl) {
        throw new Error(`${system.toUpperCase()} webhook URL not configured`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), parseTimeoutMs());

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            incidentId: incident.id,
            title: incident.title,
            description: incident.description,
            status: incident.status,
            severity: incident.severity,
            owner: incident.owner,
            services: incident.services,
            externalId: fallbackExternalId,
            source: "kubeagentix-ce",
            metadata: payload.metadata,
          }),
          signal: controller.signal,
        });

        const contentType = response.headers.get("content-type") || "";
        const responsePayload = contentType.includes("application/json")
          ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
          : {};

        if (!response.ok) {
          const message = (responsePayload.error || responsePayload.message || "").toString().trim();
          throw new Error(
            `${system.toUpperCase()} webhook sync failed (${response.status})${message ? `: ${message}` : ""}`,
          );
        }

        const responseMetadata: Record<string, string> = {};
        if (responsePayload.metadata && typeof responsePayload.metadata === "object") {
          for (const [key, value] of Object.entries(
            responsePayload.metadata as Record<string, unknown>,
          )) {
            responseMetadata[key] = String(value);
          }
        }

        const resolvedUrl = responsePayload.url
          ? String(responsePayload.url)
          : payload.url || existingRef?.url;

        return {
          externalId: String(responsePayload.externalId || fallbackExternalId),
          url: resolvedUrl,
          metadata: toMetadata(payload.metadata, responseMetadata, {
            mode: "webhook",
            lastWebhookSyncAt: String(now()),
          }),
        };
      } finally {
        clearTimeout(timeout);
      }
    };

  return {
    jira: webhookAdapter("jira"),
    slack: webhookAdapter("slack"),
  };
}

export class IncidentService {
  private readonly dataDir: string;
  private readonly now: () => number;
  private readonly diagnosisLookup: typeof getDiagnosisById;
  private readonly commandExecute: ReturnType<typeof getCommandBroker>["execute"];
  private readonly skillExecute: typeof executeSkill;
  private readonly externalSyncAdapters: Record<IncidentExternalSystem, IncidentExternalSyncAdapter>;
  private readonly incidents = new Map<string, IncidentCase>();
  private initialized = false;

  constructor(options: IncidentServiceOptions = {}) {
    this.dataDir = options.dataDir || process.env.INCIDENT_STORE_DIR || DEFAULT_DATA_DIR;
    this.now = options.now || (() => Date.now());
    this.diagnosisLookup = options.diagnosisLookup || getDiagnosisById;
    this.commandExecute = options.commandExecute || ((request) => getCommandBroker().execute(request));
    this.skillExecute = options.skillExecute || executeSkill;
    this.externalSyncAdapters = {
      ...buildDefaultExternalSyncAdapters(this.now),
      ...(options.externalSyncAdapters || {}),
    };
  }

  private normalizeIncident(incident: IncidentCase): IncidentCase {
    return {
      ...incident,
      services: incident.services || [],
      entities: incident.entities || [],
      graphEdges: incident.graphEdges || [],
      externalRefs: incident.externalRefs || [],
      correlations: incident.correlations || [],
      diagnoses: incident.diagnoses || [],
      actions: incident.actions || [],
      timeline: incident.timeline || [],
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.dataDir, { recursive: true });
    const indexPath = path.join(this.dataDir, INDEX_FILE);

    try {
      const rawIndex = await fs.readFile(indexPath, "utf8");
      const parsed = JSON.parse(rawIndex) as IncidentStoreIndex;

      for (const summary of parsed.incidents || []) {
        const incidentPath = path.join(this.dataDir, `${summary.id}.json`);
        try {
          const rawIncident = await fs.readFile(incidentPath, "utf8");
          const incident = this.normalizeIncident(JSON.parse(rawIncident) as IncidentCase);
          this.incidents.set(incident.id, incident);
        } catch {
          // Skip unreadable incident payloads; index will self-heal on next write.
        }
      }
    } catch {
      // No index present yet; initial write will create it.
    }

    this.initialized = true;
  }

  private async persistIncident(incident: IncidentCase): Promise<void> {
    const incidentPath = path.join(this.dataDir, `${incident.id}.json`);
    await fs.writeFile(incidentPath, JSON.stringify(incident, null, 2), "utf8");
  }

  private async persistIndex(): Promise<void> {
    const indexPath = path.join(this.dataDir, INDEX_FILE);
    const summaries = Array.from(this.incidents.values())
      .map(buildSummary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const payload: IncidentStoreIndex = { incidents: summaries };
    await fs.writeFile(indexPath, JSON.stringify(payload, null, 2), "utf8");
  }

  private async persist(incident: IncidentCase): Promise<void> {
    try {
      this.incidents.set(incident.id, incident);
      await this.persistIncident(incident);
      await this.persistIndex();
    } catch (error) {
      throw new IncidentServiceError(
        "INCIDENT_STORE_ERROR",
        error instanceof Error ? error.message : "Failed to persist incident",
      );
    }
  }

  private pushTimeline(
    incident: IncidentCase,
    event: Omit<IncidentTimelineEvent, "id" | "timestamp">,
  ): void {
    incident.timeline.push({
      id: uuidv4(),
      timestamp: this.now(),
      ...event,
    });
    incident.updatedAt = this.now();
  }

  private assertTransition(current: IncidentStatus, next: IncidentStatus): void {
    if (current === next) return;
    if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
      throw new IncidentServiceError(
        "INCIDENT_INVALID_TRANSITION",
        `Invalid status transition: ${current} -> ${next}`,
      );
    }
  }

  async listIncidents(query: ListIncidentsQuery = {}): Promise<ListIncidentsResponse> {
    await this.ensureInitialized();

    let incidents = Array.from(this.incidents.values());

    if (query.status) incidents = incidents.filter((item) => item.status === query.status);
    if (query.severity) incidents = incidents.filter((item) => item.severity === query.severity);
    if (query.source) incidents = incidents.filter((item) => item.source === query.source);
    if (query.owner) incidents = incidents.filter((item) => item.owner === query.owner);
    if (query.service) incidents = incidents.filter((item) => item.services.includes(query.service!));
    if (query.q) {
      incidents = incidents.filter((item) => {
        const haystack = [item.title, item.description, item.owner || "", ...item.services].join(" ");
        return includesCaseInsensitive(haystack, query.q);
      });
    }

    incidents.sort((a, b) => b.updatedAt - a.updatedAt);

    const total = incidents.length;
    const offset = Math.max(0, query.offset || 0);
    const limit = Math.max(1, Math.min(query.limit || 50, 200));

    return {
      items: incidents.slice(offset, offset + limit).map(buildSummary),
      total,
    };
  }

  async getIncidentById(incidentId: string): Promise<IncidentCase> {
    await this.ensureInitialized();
    const loaded = this.incidents.get(incidentId);
    const incident = loaded ? this.normalizeIncident(loaded) : undefined;
    if (!incident) {
      throw new IncidentServiceError("INCIDENT_NOT_FOUND", `Incident not found: ${incidentId}`);
    }
    if (loaded !== incident) {
      this.incidents.set(incident.id, incident);
    }
    return incident;
  }

  async createIncident(payload: CreateIncidentRequest): Promise<IncidentCase> {
    await this.ensureInitialized();

    const title = payload.title?.trim();
    if (!title) {
      throw new IncidentServiceError("INCIDENT_VALIDATION_ERROR", "title is required");
    }

    const now = this.now();
    const incident: IncidentCase = {
      id: `inc-${uuidv4()}`,
      title,
      description: payload.description?.trim() || "",
      status: payload.status || "new",
      severity: payload.severity || "high",
      owner: payload.owner?.trim() || undefined,
      services: normalizeServices(payload.services),
      entities: payload.entities || [],
      graphEdges: [],
      source: payload.source || "manual",
      externalRefs: payload.externalRefs || [],
      correlations: payload.correlations || [],
      diagnoses: [],
      actions: [],
      timeline: [],
      createdAt: now,
      updatedAt: now,
    };

    this.pushTimeline(incident, {
      type: "intake",
      actor: payload.actor || "system",
      source: incident.source,
      message: `Incident created: ${incident.title}`,
      payload: {
        status: incident.status,
        severity: incident.severity,
      },
    });

    await this.persist(incident);
    return incident;
  }

  async updateIncident(incidentId: string, payload: UpdateIncidentRequest): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);

    if (payload.status) {
      this.assertTransition(incident.status, payload.status);
      if (incident.status !== payload.status) {
        const previous = incident.status;
        incident.status = payload.status;
        this.pushTimeline(incident, {
          type: "status",
          actor: payload.actor || "system",
          source: "api",
          message: `Status changed: ${previous} -> ${payload.status}`,
          payload: { previous, next: payload.status },
        });
      }
    }

    if (payload.title !== undefined) {
      const nextTitle = payload.title.trim();
      if (!nextTitle) {
        throw new IncidentServiceError("INCIDENT_VALIDATION_ERROR", "title cannot be empty");
      }
      incident.title = nextTitle;
    }

    if (payload.description !== undefined) {
      incident.description = payload.description.trim();
    }

    if (payload.severity && incident.severity !== payload.severity) {
      const previous = incident.severity;
      incident.severity = payload.severity;
      this.pushTimeline(incident, {
        type: "triage",
        actor: payload.actor || "system",
        source: "api",
        message: `Severity updated: ${previous} -> ${payload.severity}`,
        payload: { previous, next: payload.severity },
      });
    }

    if (payload.owner !== undefined && incident.owner !== payload.owner) {
      const previous = incident.owner;
      incident.owner = payload.owner?.trim() || undefined;
      this.pushTimeline(incident, {
        type: "triage",
        actor: payload.actor || "system",
        source: "api",
        message: `Owner updated: ${previous || "unassigned"} -> ${incident.owner || "unassigned"}`,
        payload: { previous, next: incident.owner },
      });
    }

    if (payload.services) {
      incident.services = normalizeServices(payload.services);
    }

    incident.updatedAt = this.now();
    await this.persist(incident);
    return incident;
  }

  async attachDiagnosis(
    incidentId: string,
    payload: AttachIncidentDiagnosisRequest,
  ): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);

    if (!payload.diagnosisId?.trim()) {
      throw new IncidentServiceError("INCIDENT_VALIDATION_ERROR", "diagnosisId is required");
    }

    if (incident.diagnoses.some((item) => item.diagnosisId === payload.diagnosisId)) {
      return incident;
    }

    const diagnosis = this.diagnosisLookup(payload.diagnosisId);
    if (!diagnosis) {
      throw new IncidentServiceError(
        "INCIDENT_DIAGNOSIS_NOT_FOUND",
        `Diagnosis not found: ${payload.diagnosisId}`,
      );
    }

    incident.diagnoses.push({
      diagnosisId: payload.diagnosisId,
      resource: diagnosis.resource,
      probableRootCause: diagnosis.probableRootCause,
      attachedAt: this.now(),
      attachedBy: payload.attachedBy || "system",
    });

    this.pushTimeline(incident, {
      type: "diagnosis",
      actor: payload.attachedBy || "system",
      source: "quickdx",
      message: `Diagnosis attached: ${payload.diagnosisId}`,
      payload: {
        resource: `${diagnosis.resource.kind}/${diagnosis.resource.namespace}/${diagnosis.resource.name}`,
        note: payload.note,
      },
      correlationKeys: [`diagnosis:${payload.diagnosisId}`],
    });

    await this.persist(incident);
    return incident;
  }

  async createAction(incidentId: string, payload: CreateIncidentActionRequest): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);

    if (!payload.title?.trim()) {
      throw new IncidentServiceError("INCIDENT_VALIDATION_ERROR", "title is required");
    }

    if (payload.type === "command" && !payload.command?.trim()) {
      throw new IncidentServiceError("INCIDENT_ACTION_INVALID", "command is required for command actions");
    }

    if (payload.type === "skill" && !payload.skillId?.trim()) {
      throw new IncidentServiceError("INCIDENT_ACTION_INVALID", "skillId is required for skill actions");
    }

    const now = this.now();
    const requiresApproval = payload.requiresApproval !== false;

    const action: IncidentAction = {
      id: `act-${uuidv4()}`,
      title: payload.title.trim(),
      description: payload.description?.trim() || undefined,
      type: payload.type,
      risk: payload.risk || "medium",
      requiresApproval,
      approvalState: requiresApproval ? "pending" : "approved",
      proposedBy: payload.proposedBy || "system",
      command: payload.command?.trim(),
      skillId: payload.skillId?.trim(),
      skillInput: payload.skillInput || {},
      dryRun: payload.dryRun,
      createdAt: now,
      updatedAt: now,
    };

    incident.actions.push(action);
    this.pushTimeline(incident, {
      type: "action",
      actor: action.proposedBy,
      source: "api",
      message: `Action proposed: ${action.title}`,
      payload: {
        actionId: action.id,
        type: action.type,
        requiresApproval: action.requiresApproval,
        risk: action.risk,
      },
      correlationKeys: [`action:${action.id}`],
    });

    await this.persist(incident);
    return incident;
  }

  private getAction(incident: IncidentCase, actionId: string): IncidentAction {
    const action = incident.actions.find((item) => item.id === actionId);
    if (!action) {
      throw new IncidentServiceError("INCIDENT_ACTION_NOT_FOUND", `Action not found: ${actionId}`);
    }
    return action;
  }

  private upsertExternalRef(
    incident: IncidentCase,
    system: IncidentExternalSystem,
    externalId: string,
    url?: string,
  ): IncidentExternalRef {
    const existing = incident.externalRefs.find((ref) => ref.system === system);
    if (existing) {
      existing.externalId = externalId || existing.externalId;
      existing.url = url || existing.url;
      return existing;
    }

    const created: IncidentExternalRef = {
      system,
      externalId,
      url,
      syncStatus: "pending",
      lastSyncedAt: this.now(),
    };
    incident.externalRefs.push(created);
    return created;
  }

  private findIncidentForWebhook(
    preferredIncidentId: string | undefined,
    externalSystem: IncidentExternalSystem | undefined,
    externalId: string,
  ): IncidentCase | undefined {
    if (preferredIncidentId) {
      const preferred = this.incidents.get(preferredIncidentId);
      if (preferred) return preferred;
    }

    if (!externalSystem) {
      return undefined;
    }

    return Array.from(this.incidents.values()).find((item) =>
      item.externalRefs.some((ref) => ref.system === externalSystem && ref.externalId === externalId),
    );
  }

  async approveAction(
    incidentId: string,
    actionId: string,
    payload: ApproveIncidentActionRequest,
  ): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);
    const action = this.getAction(incident, actionId);

    const approved = payload.approved !== false;
    const actor = payload.actor || "system";

    if (approved) {
      action.approvalState = "approved";
      action.approvedBy = actor;
      action.approvedAt = this.now();
      action.updatedAt = this.now();
      this.pushTimeline(incident, {
        type: "action",
        actor,
        source: "api",
        message: `Action approved: ${action.title}`,
        payload: { actionId: action.id },
        correlationKeys: [`action:${action.id}`],
      });
    } else {
      action.approvalState = "rejected";
      action.rejectedBy = actor;
      action.rejectedAt = this.now();
      action.rejectionReason = payload.reason?.trim() || "Rejected by operator";
      action.updatedAt = this.now();
      this.pushTimeline(incident, {
        type: "action",
        actor,
        source: "api",
        message: `Action rejected: ${action.title}`,
        payload: { actionId: action.id, reason: action.rejectionReason },
        correlationKeys: [`action:${action.id}`],
      });
    }

    await this.persist(incident);
    return incident;
  }

  async executeAction(
    incidentId: string,
    actionId: string,
    payload: ExecuteIncidentActionRequest,
  ): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);
    const action = this.getAction(incident, actionId);

    if (action.requiresApproval && action.approvalState !== "approved") {
      throw new IncidentServiceError(
        "INCIDENT_ACTION_NOT_APPROVED",
        `Action ${action.id} must be approved before execution`,
      );
    }

    const actor = payload.actor || "system";
    const startedAt = this.now();
    let success = false;
    let output = "";
    let error = "";
    let commandExitCode: number | undefined;

    try {
      if (action.type === "command") {
        const response = await this.commandExecute({
          command: action.command || "",
          context: payload.context,
          clusterContext: payload.context,
        });
        commandExitCode = response.exitCode;
        success = response.exitCode === 0;
        output = response.stdout;
        error = response.stderr;
      } else if (action.type === "skill") {
        const result = await this.skillExecute(action.skillId || "", {
          dryRun: payload.dryRun ?? action.dryRun ?? true,
          input: action.skillInput || {},
          namespace: payload.namespace,
          context: payload.context,
        });
        if (!result) {
          throw new IncidentServiceError("INCIDENT_ACTION_INVALID", "skill not found");
        }
        success = result.status === "success";
        output = result.steps
          .map((step) => `${step.title}: ${step.status}${step.message ? ` (${step.message})` : ""}`)
          .join("\n");
      } else {
        success = true;
        output = "Manual action marked as executed by operator";
      }
    } catch (executeError) {
      if (executeError instanceof IncidentServiceError) {
        throw executeError;
      }
      success = false;
      error = executeError instanceof Error ? executeError.message : "Action execution failed";
    }

    action.execution = {
      success,
      startedAt,
      finishedAt: this.now(),
      output: output || undefined,
      error: error || undefined,
      commandExitCode,
      dryRun: payload.dryRun ?? action.dryRun,
    };
    action.executedBy = actor;
    action.executedAt = this.now();
    action.updatedAt = this.now();
    action.approvalState = "executed";

    this.pushTimeline(incident, {
      type: "action",
      actor,
      source: "api",
      message: `Action executed: ${action.title} (${success ? "success" : "failed"})`,
      payload: {
        actionId: action.id,
        success,
        dryRun: payload.dryRun ?? action.dryRun,
      },
      correlationKeys: [`action:${action.id}`],
    });

    await this.persist(incident);
    return incident;
  }

  async syncExternal(
    incidentId: string,
    system: IncidentExternalSystem,
    payload: ForceIncidentSyncRequest,
  ): Promise<IncidentCase> {
    const incident = await this.getIncidentById(incidentId);
    const actor = payload.actor || "system";
    const externalId = payload.externalId?.trim() || defaultExternalId(system, incident);
    const existingRef = incident.externalRefs.find((ref) => ref.system === system);
    const externalRef = this.upsertExternalRef(incident, system, externalId, payload.url);
    externalRef.syncStatus = "pending";
    externalRef.lastSyncedAt = this.now();
    externalRef.metadata = toMetadata(externalRef.metadata, payload.metadata, {
      syncMode: resolveSyncMode(system),
      lastSyncAttemptAt: String(this.now()),
      lastSyncActor: actor,
    });

    this.pushTimeline(incident, {
      type: "sync",
      actor,
      source: system,
      message: `${system.toUpperCase()} sync started`,
      payload: { externalId: externalRef.externalId },
      correlationKeys: [`${system}:${externalRef.externalId}`],
    });

    const adapter = this.externalSyncAdapters[system];
    try {
      const result = await adapter({
        system,
        incident,
        payload,
        existingRef,
      });
      const syncedAt = this.now();
      externalRef.externalId = result.externalId?.trim() || externalRef.externalId;
      externalRef.url = result.url?.trim() || payload.url || externalRef.url;
      externalRef.syncStatus = "success";
      externalRef.lastSyncedAt = syncedAt;
      externalRef.metadata = toMetadata(externalRef.metadata, payload.metadata, result.metadata, {
        lastSuccessfulSyncAt: String(syncedAt),
        lastSyncError: "",
      });

      this.pushTimeline(incident, {
        type: "sync",
        actor,
        source: system,
        message: `${system.toUpperCase()} sync completed`,
        payload: {
          externalId: externalRef.externalId,
          url: externalRef.url,
        },
        correlationKeys: [`${system}:${externalRef.externalId}`],
      });

      await this.persist(incident);
      return incident;
    } catch (syncError) {
      const failedAt = this.now();
      const message = syncError instanceof Error ? syncError.message : "External sync failed";
      externalRef.syncStatus = "failed";
      externalRef.lastSyncedAt = failedAt;
      externalRef.metadata = toMetadata(externalRef.metadata, payload.metadata, {
        lastFailedSyncAt: String(failedAt),
        lastSyncError: message,
        retryable: "true",
      });

      this.pushTimeline(incident, {
        type: "sync",
        actor,
        source: system,
        message: `${system.toUpperCase()} sync failed`,
        payload: {
          externalId: externalRef.externalId,
          error: message,
        },
        correlationKeys: [`${system}:${externalRef.externalId}`],
      });

      await this.persist(incident);
      throw new IncidentServiceError(
        "INCIDENT_SYNC_FAILED",
        `${system.toUpperCase()} sync failed: ${message}`,
      );
    }
  }

  private async runKubectlItems(
    command: string,
    clusterContext: string | undefined,
    warnings: string[],
  ): Promise<any[]> {
    try {
      const response = await this.commandExecute({
        command,
        clusterContext,
        timeoutMs: DEFAULT_GRAPH_TIMEOUT_MS,
        maxOutputBytes: MAX_GRAPH_OUTPUT_BYTES,
      });

      if (response.exitCode !== 0) {
        warnings.push(`${command}: ${response.stderr || `exit ${response.exitCode}`}`);
        return [];
      }

      const parsed = JSON.parse(response.stdout || "{\"items\":[]}") as { items?: any[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (error) {
      warnings.push(`${command}: ${error instanceof Error ? error.message : "failed"}`);
      return [];
    }
  }

  private async runKubectlText(
    command: string,
    clusterContext: string | undefined,
    warnings: string[],
  ): Promise<string> {
    try {
      const response = await this.commandExecute({
        command,
        clusterContext,
        timeoutMs: DEFAULT_GRAPH_TIMEOUT_MS,
        maxOutputBytes: 1024 * 1024,
      });

      if (response.exitCode !== 0) {
        warnings.push(`${command}: ${response.stderr || `exit ${response.exitCode}`}`);
        return "";
      }

      return response.stdout.trim();
    } catch (error) {
      warnings.push(`${command}: ${error instanceof Error ? error.message : "failed"}`);
      return "";
    }
  }

  async investigateIncident(
    incidentId: string,
    payload: InvestigateIncidentRequest = {},
  ): Promise<InvestigateIncidentResponse> {
    const incident = await this.getIncidentById(incidentId);
    const actor = payload.actor || "system";
    const clusterContext = payload.clusterContext;
    const graphMode = (process.env.INCIDENT_GRAPH_MODE || "live").trim().toLowerCase();
    const maxEntities = Math.max(
      20,
      Math.min(payload.maxEntities || DEFAULT_MAX_GRAPH_ENTITIES, 500),
    );
    const warnings: string[] = [];

    if (graphMode === "mock") {
      this.pushTimeline(incident, {
        type: "analysis",
        actor,
        source: "system",
        message: `Layered investigation graph updated in mock mode (${incident.entities.length} entities)`,
        payload: {
          entityCount: incident.entities.length,
          edgeCount: incident.graphEdges.length,
          correlationCount: incident.correlations.length,
          warningCount: 1,
        },
        correlationKeys: [`incident:${incident.id}`, "graph:layered-v1:mock"],
      });
      warnings.push("Incident graph mode is mock; skipped live kubectl enrichment");
      await this.persist(incident);
      return {
        incident,
        summary: {
          entityCount: incident.entities.length,
          edgeCount: incident.graphEdges.length,
          correlationCount: incident.correlations.length,
          warningCount: warnings.length,
        },
        warnings,
      };
    }

    const entityMap = new Map<string, IncidentEntity>();
    for (const entity of incident.entities || []) {
      entityMap.set(entity.id, entity);
    }

    const edgeMap = new Map<string, IncidentGraphEdge>();
    for (const edge of incident.graphEdges || []) {
      edgeMap.set(edge.id, edge);
    }

    const correlationMap = new Map<string, IncidentCorrelation>();
    for (const correlation of incident.correlations || []) {
      correlationMap.set(correlation.signalId, correlation);
    }

    const addEntity = (entity: IncidentEntity): IncidentEntity | null => {
      if (!entity.id || !entity.kind || !entity.name) return null;
      if (!entityMap.has(entity.id) && entityMap.size >= maxEntities) return null;
      const existing = entityMap.get(entity.id);
      entityMap.set(entity.id, {
        ...existing,
        ...entity,
        metadata: toMetadata(existing?.metadata, entity.metadata),
      });
      return entityMap.get(entity.id)!;
    };

    const addEdge = (edge: IncidentGraphEdge): void => {
      if (!entityMap.has(edge.fromEntityId) || !entityMap.has(edge.toEntityId)) return;
      const id =
        edge.id ||
        `${edge.relationship}:${edge.fromEntityId}->${edge.toEntityId}`;
      edgeMap.set(id, {
        ...edge,
        id,
        confidence: Math.max(1, Math.min(100, Math.round(edge.confidence))),
      });
    };

    const addCorrelation = (correlation: IncidentCorrelation): void => {
      const entityIds = Array.from(
        new Set(correlation.entityIds.filter((entityId) => entityMap.has(entityId))),
      );
      if (entityIds.length === 0) return;
      correlationMap.set(correlation.signalId, {
        ...correlation,
        entityIds,
        confidence: Math.max(1, Math.min(100, Math.round(correlation.confidence))),
      });
    };

    const targetNamespaces = new Set<string>();
    const serviceHints = new Set(
      incident.services.map((service) => service.trim().toLowerCase()).filter(Boolean),
    );

    for (const diagnosis of incident.diagnoses || []) {
      const id = buildEntityId(
        diagnosis.resource.kind,
        diagnosis.resource.namespace,
        diagnosis.resource.name,
      );
      addEntity({
        id,
        layer: "app",
        kind: diagnosis.resource.kind,
        name: diagnosis.resource.name,
        namespace: diagnosis.resource.namespace,
        metadata: { source: "diagnosis", diagnosisId: diagnosis.diagnosisId },
      });
      if (diagnosis.resource.namespace) targetNamespaces.add(diagnosis.resource.namespace);
    }

    for (const entity of incident.entities || []) {
      if (entity.namespace) targetNamespaces.add(entity.namespace);
    }

    if (payload.namespace?.trim()) {
      targetNamespaces.add(payload.namespace.trim());
    }
    if (targetNamespaces.size === 0) {
      targetNamespaces.add("default");
    }

    const resourceInScope = (namespace?: string): boolean =>
      !namespace || targetNamespaces.has(namespace);

    const ingresses = await this.runKubectlItems("kubectl get ingress -A -o json", clusterContext, warnings);
    const services = await this.runKubectlItems("kubectl get services -A -o json", clusterContext, warnings);
    const endpoints = await this.runKubectlItems("kubectl get endpoints -A -o json", clusterContext, warnings);
    const deployments = await this.runKubectlItems("kubectl get deployments -A -o json", clusterContext, warnings);
    const statefulsets = await this.runKubectlItems("kubectl get statefulsets -A -o json", clusterContext, warnings);
    const daemonsets = await this.runKubectlItems("kubectl get daemonsets -A -o json", clusterContext, warnings);
    const pods = await this.runKubectlItems("kubectl get pods -A -o json", clusterContext, warnings);
    const nodes = await this.runKubectlItems("kubectl get nodes -o json", clusterContext, warnings);
    const networkPolicies = await this.runKubectlItems("kubectl get networkpolicies -A -o json", clusterContext, warnings);
    const roleBindings = await this.runKubectlItems("kubectl get rolebindings -A -o json", clusterContext, warnings);
    const clusterRoleBindings = await this.runKubectlItems("kubectl get clusterrolebindings -o json", clusterContext, warnings);
    const warningEvents = await this.runKubectlItems(
      "kubectl get events -A --field-selector type=Warning -o json",
      clusterContext,
      warnings,
    );

    const podByNamespaceName = new Map<string, any>();
    for (const pod of pods) {
      const namespace = pod?.metadata?.namespace;
      const name = pod?.metadata?.name;
      if (!namespace || !name || !resourceInScope(namespace)) continue;
      podByNamespaceName.set(`${namespace}/${name}`, pod);
    }

    const workloadCandidates = [...deployments, ...statefulsets, ...daemonsets].filter((workload) =>
      resourceInScope(workload?.metadata?.namespace),
    );

    const relevantPods = new Set<string>();
    const relevantServices = new Set<string>();
    const relevantWorkloads = new Set<string>();

    for (const entity of entityMap.values()) {
      if (entity.layer !== "app") continue;
      const entityKey = `${entity.namespace || ""}/${entity.name}`;
      if (entity.kind.toLowerCase() === "pod") relevantPods.add(entityKey);
      else relevantWorkloads.add(`${entity.kind.toLowerCase()}:${entityKey}`);
    }

    for (const workload of workloadCandidates) {
      const namespace = workload?.metadata?.namespace;
      const name = workload?.metadata?.name;
      if (!namespace || !name) continue;

      const labels = toRecord(workload?.metadata?.labels);
      const workloadKey = `${workload?.kind?.toLowerCase()}:${namespace}/${name}`;
      const hinted =
        serviceHints.size === 0 ||
        serviceHints.has(name.toLowerCase()) ||
        Object.values(labels).some((value) => serviceHints.has(value.toLowerCase()));
      const seeded = relevantWorkloads.has(workloadKey);
      if (!hinted && !seeded) continue;

      const workloadEntity = addEntity({
        id: buildEntityId(workload.kind || "Workload", namespace, name),
        layer: "app",
        kind: workload.kind || "Workload",
        name,
        namespace,
        metadata: { source: "k8s-graph" },
      });
      if (!workloadEntity) continue;

      relevantWorkloads.add(workloadKey);

      for (const pod of podByNamespaceName.values()) {
        if (pod?.metadata?.namespace !== namespace) continue;
        const owners = pod?.metadata?.ownerReferences || [];
        const owned = owners.some(
          (owner: any) =>
            owner?.name === name && (owner?.kind || "").toLowerCase() === (workload?.kind || "").toLowerCase(),
        );
        if (!owned) continue;

        const podEntity = addEntity({
          id: buildEntityId("Pod", namespace, pod.metadata.name),
          layer: "app",
          kind: "Pod",
          name: pod.metadata.name,
          namespace,
          metadata: {
            nodeName: pod?.spec?.nodeName || "",
            serviceAccountName: pod?.spec?.serviceAccountName || "default",
          },
        });
        if (!podEntity) continue;
        relevantPods.add(`${namespace}/${pod.metadata.name}`);

        addEdge({
          id: `workload_owns_pod:${workloadEntity.id}->${podEntity.id}`,
          fromEntityId: workloadEntity.id,
          toEntityId: podEntity.id,
          relationship: "workload_owns_pod",
          layer: "app",
          confidence: 94,
          rationale: `${workload.kind}/${name} owns pod ${pod.metadata.name}`,
        });
      }
    }

    for (const service of services) {
      const namespace = service?.metadata?.namespace;
      const name = service?.metadata?.name;
      if (!namespace || !name || !resourceInScope(namespace)) continue;

      const selector = toRecord(service?.spec?.selector);
      const hinted =
        serviceHints.size === 0 ||
        serviceHints.has(name.toLowerCase()) ||
        Object.values(selector).some((value) => serviceHints.has(value.toLowerCase()));

      const matchedPods = Array.from(podByNamespaceName.values()).filter(
        (pod) =>
          pod?.metadata?.namespace === namespace &&
          labelsMatch(selector, toRecord(pod?.metadata?.labels)),
      );
      const hasRelevantPod = matchedPods.some((pod) =>
        relevantPods.has(`${namespace}/${pod?.metadata?.name}`),
      );

      if (!hinted && !hasRelevantPod) continue;

      const serviceEntity = addEntity({
        id: buildEntityId("Service", namespace, name),
        layer: "edge",
        kind: "Service",
        name,
        namespace,
        service: name,
        metadata: { source: "k8s-graph" },
      });
      if (!serviceEntity) continue;
      relevantServices.add(`${namespace}/${name}`);

      for (const pod of matchedPods.slice(0, 30)) {
        const podEntity = addEntity({
          id: buildEntityId("Pod", namespace, pod.metadata.name),
          layer: "app",
          kind: "Pod",
          name: pod.metadata.name,
          namespace,
          metadata: {
            nodeName: pod?.spec?.nodeName || "",
            serviceAccountName: pod?.spec?.serviceAccountName || "default",
          },
        });
        if (!podEntity) continue;
        relevantPods.add(`${namespace}/${pod.metadata.name}`);
        addEdge({
          id: `service_targets_pod:${serviceEntity.id}->${podEntity.id}`,
          fromEntityId: serviceEntity.id,
          toEntityId: podEntity.id,
          relationship: "service_targets_pod",
          layer: "edge",
          confidence: 89,
          rationale: `Service selector matches pod labels`,
        });
      }

      const endpoint = endpoints.find(
        (item) =>
          item?.metadata?.namespace === namespace && item?.metadata?.name === name,
      );
      if (endpoint) {
        const endpointEntity = addEntity({
          id: buildEntityId("Endpoints", namespace, name),
          layer: "edge",
          kind: "Endpoints",
          name,
          namespace,
          metadata: { source: "k8s-graph" },
        });
        if (endpointEntity) {
          addEdge({
            id: `service_resolves_endpoint:${serviceEntity.id}->${endpointEntity.id}`,
            fromEntityId: serviceEntity.id,
            toEntityId: endpointEntity.id,
            relationship: "service_resolves_endpoint",
            layer: "edge",
            confidence: 92,
            rationale: "Service and Endpoints share namespace/name",
          });
        }
      }
    }

    for (const ingress of ingresses) {
      const namespace = ingress?.metadata?.namespace;
      const name = ingress?.metadata?.name;
      if (!namespace || !name || !resourceInScope(namespace)) continue;

      const backends: string[] = [];
      const rules = ingress?.spec?.rules || [];
      for (const rule of rules) {
        const paths = rule?.http?.paths || [];
        for (const pathEntry of paths) {
          const backendService = pathEntry?.backend?.service?.name;
          if (backendService) backends.push(backendService);
        }
      }
      const defaultBackend = ingress?.spec?.defaultBackend?.service?.name;
      if (defaultBackend) backends.push(defaultBackend);

      const relevantTargets = backends.filter((backend) =>
        relevantServices.has(`${namespace}/${backend}`),
      );
      if (relevantTargets.length === 0) continue;

      const ingressEntity = addEntity({
        id: buildEntityId("Ingress", namespace, name),
        layer: "edge",
        kind: "Ingress",
        name,
        namespace,
        metadata: { source: "k8s-graph" },
      });
      if (!ingressEntity) continue;

      for (const serviceName of relevantTargets) {
        const serviceEntityId = buildEntityId("Service", namespace, serviceName);
        if (!entityMap.has(serviceEntityId)) continue;
        addEdge({
          id: `ingress_routes_to_service:${ingressEntity.id}->${serviceEntityId}`,
          fromEntityId: ingressEntity.id,
          toEntityId: serviceEntityId,
          relationship: "ingress_routes_to_service",
          layer: "edge",
          confidence: 87,
          rationale: "Ingress backend routes traffic to Service",
        });
      }
    }

    const nodeByName = new Map<string, any>();
    for (const node of nodes) {
      const name = node?.metadata?.name;
      if (name) nodeByName.set(name, node);
    }

    const relevantServiceAccounts = new Set<string>();
    for (const podKey of relevantPods) {
      const pod = podByNamespaceName.get(podKey);
      if (!pod) continue;
      const namespace = pod?.metadata?.namespace;
      const podName = pod?.metadata?.name;
      const nodeName = pod?.spec?.nodeName;
      const serviceAccountName = pod?.spec?.serviceAccountName || "default";
      relevantServiceAccounts.add(`${namespace}/${serviceAccountName}`);

      if (nodeName) {
        const nodeEntity = addEntity({
          id: buildEntityId("Node", undefined, nodeName),
          layer: "platform",
          kind: "Node",
          name: nodeName,
          metadata: { source: "k8s-graph" },
        });
        const podEntityId = buildEntityId("Pod", namespace, podName);
        if (nodeEntity && entityMap.has(podEntityId)) {
          addEdge({
            id: `pod_scheduled_on_node:${podEntityId}->${nodeEntity.id}`,
            fromEntityId: podEntityId,
            toEntityId: nodeEntity.id,
            relationship: "pod_scheduled_on_node",
            layer: "platform",
            confidence: 96,
            rationale: "Pod spec.nodeName points to node",
          });
        }

        const node = nodeByName.get(nodeName);
        const unhealthy = (node?.status?.conditions || []).some(
          (condition: any) =>
            condition?.type === "Ready" && condition?.status !== "True",
        );
        if (unhealthy && nodeEntity) {
          addCorrelation({
            signalId: `node-unready:${nodeName}`,
            entityIds: [nodeEntity.id, buildEntityId("Pod", namespace, podName)],
            confidence: 84,
            rationale: `Node ${nodeName} is not Ready for scheduled workload pod ${podName}`,
          });
        }
      }
    }

    for (const policy of networkPolicies) {
      const namespace = policy?.metadata?.namespace;
      const name = policy?.metadata?.name;
      if (!namespace || !name || !resourceInScope(namespace)) continue;

      const selector = toRecord(policy?.spec?.podSelector?.matchLabels);
      const matchedPods = Array.from(relevantPods)
        .map((podKey) => podByNamespaceName.get(podKey))
        .filter((pod) => pod?.metadata?.namespace === namespace)
        .filter((pod) => labelsMatch(selector, toRecord(pod?.metadata?.labels)));
      if (matchedPods.length === 0) continue;

      const policyEntity = addEntity({
        id: buildEntityId("NetworkPolicy", namespace, name),
        layer: "network",
        kind: "NetworkPolicy",
        name,
        namespace,
        metadata: { source: "k8s-graph" },
      });
      if (!policyEntity) continue;

      for (const pod of matchedPods) {
        const podEntityId = buildEntityId("Pod", namespace, pod.metadata.name);
        addEdge({
          id: `networkpolicy_selects_pod:${policyEntity.id}->${podEntityId}`,
          fromEntityId: policyEntity.id,
          toEntityId: podEntityId,
          relationship: "networkpolicy_selects_pod",
          layer: "network",
          confidence: 82,
          rationale: "NetworkPolicy podSelector matches pod labels",
        });
      }
    }

    for (const serviceAccountKey of relevantServiceAccounts) {
      const [namespace, serviceAccountName] = serviceAccountKey.split("/");
      if (!namespace || !serviceAccountName) continue;
      const serviceAccountEntity = addEntity({
        id: buildEntityId("ServiceAccount", namespace, serviceAccountName),
        layer: "rbac",
        kind: "ServiceAccount",
        name: serviceAccountName,
        namespace,
        metadata: { source: "k8s-graph" },
      });
      if (!serviceAccountEntity) continue;

      for (const roleBinding of roleBindings) {
        if (roleBinding?.metadata?.namespace !== namespace) continue;
        const subjects = roleBinding?.subjects || [];
        const matches = subjects.some(
          (subject: any) =>
            subject?.kind === "ServiceAccount" &&
            subject?.name === serviceAccountName &&
            (subject?.namespace || namespace) === namespace,
        );
        if (!matches) continue;

        const roleBindingEntity = addEntity({
          id: buildEntityId(
            "RoleBinding",
            namespace,
            roleBinding?.metadata?.name || "unknown",
          ),
          layer: "rbac",
          kind: "RoleBinding",
          name: roleBinding?.metadata?.name || "unknown",
          namespace,
          metadata: {
            roleRef: roleBinding?.roleRef?.name || "",
          },
        });
        if (!roleBindingEntity) continue;

        addEdge({
          id: `rolebinding_targets_serviceaccount:${roleBindingEntity.id}->${serviceAccountEntity.id}`,
          fromEntityId: roleBindingEntity.id,
          toEntityId: serviceAccountEntity.id,
          relationship: "rolebinding_targets_serviceaccount",
          layer: "rbac",
          confidence: 95,
          rationale: "RoleBinding subjects include ServiceAccount",
        });
      }

      for (const clusterRoleBinding of clusterRoleBindings) {
        const subjects = clusterRoleBinding?.subjects || [];
        const matches = subjects.some(
          (subject: any) =>
            subject?.kind === "ServiceAccount" &&
            subject?.name === serviceAccountName &&
            subject?.namespace === namespace,
        );
        if (!matches) continue;

        const clusterRoleBindingEntity = addEntity({
          id: buildEntityId(
            "ClusterRoleBinding",
            undefined,
            clusterRoleBinding?.metadata?.name || "unknown",
          ),
          layer: "rbac",
          kind: "ClusterRoleBinding",
          name: clusterRoleBinding?.metadata?.name || "unknown",
          metadata: {
            roleRef: clusterRoleBinding?.roleRef?.name || "",
          },
        });
        if (!clusterRoleBindingEntity) continue;

        addEdge({
          id: `clusterrolebinding_targets_serviceaccount:${clusterRoleBindingEntity.id}->${serviceAccountEntity.id}`,
          fromEntityId: clusterRoleBindingEntity.id,
          toEntityId: serviceAccountEntity.id,
          relationship: "clusterrolebinding_targets_serviceaccount",
          layer: "rbac",
          confidence: 95,
          rationale: "ClusterRoleBinding subjects include ServiceAccount",
        });
      }

      const canI = await this.runKubectlText(
        `kubectl auth can-i get pods --as system:serviceaccount:${namespace}:${serviceAccountName} -n ${namespace}`,
        clusterContext,
        warnings,
      );
      const denied = canI.toLowerCase() === "no";
      if (denied) {
        addCorrelation({
          signalId: `rbac-can-i-denied:${namespace}:${serviceAccountName}`,
          entityIds: [serviceAccountEntity.id],
          confidence: 78,
          rationale: `ServiceAccount ${namespace}/${serviceAccountName} cannot list pods in namespace`,
        });
      }
    }

    for (const event of warningEvents.slice(0, 200)) {
      const involved = event?.involvedObject;
      const kind = involved?.kind;
      const name = involved?.name;
      if (!kind || !name) continue;
      const namespace = involved?.namespace;
      const entityId = buildEntityId(kind, namespace, name);
      if (!entityMap.has(entityId)) continue;
      addCorrelation({
        signalId: `warning-event:${event?.metadata?.uid || `${kind}:${name}:${event?.reason || "warning"}`}`,
        entityIds: [entityId],
        confidence: 72,
        rationale: `${event?.reason || "Warning"}: ${event?.message || "Cluster warning event detected"}`,
      });
    }

    incident.entities = Array.from(entityMap.values()).sort((a, b) =>
      `${a.layer}:${a.kind}:${a.name}`.localeCompare(`${b.layer}:${b.kind}:${b.name}`),
    );
    incident.graphEdges = Array.from(edgeMap.values()).sort((a, b) =>
      `${a.relationship}:${a.fromEntityId}:${a.toEntityId}`.localeCompare(
        `${b.relationship}:${b.fromEntityId}:${b.toEntityId}`,
      ),
    );
    incident.correlations = Array.from(correlationMap.values()).sort(
      (a, b) => b.confidence - a.confidence,
    );

    this.pushTimeline(incident, {
      type: "analysis",
      actor,
      source: "system",
      message: `Layered investigation graph updated (${incident.entities.length} entities, ${incident.graphEdges.length} edges)`,
      payload: {
        entityCount: incident.entities.length,
        edgeCount: incident.graphEdges.length,
        correlationCount: incident.correlations.length,
        warningCount: warnings.length,
      },
      correlationKeys: [`incident:${incident.id}`, "graph:layered-v1"],
    });

    await this.persist(incident);

    return {
      incident,
      summary: {
        entityCount: incident.entities.length,
        edgeCount: incident.graphEdges.length,
        correlationCount: incident.correlations.length,
        warningCount: warnings.length,
      },
      warnings,
    };
  }

  async ingestWebhook(
    system: IncidentSource,
    payload: IncidentWebhookRequest,
  ): Promise<IncidentCase> {
    await this.ensureInitialized();

    const externalId = payload.externalId?.trim();
    if (!externalId) {
      throw new IncidentServiceError("INCIDENT_VALIDATION_ERROR", "externalId is required");
    }
    const eventKey = payload.eventId?.trim();
    const inboundUpdatedAt =
      payload.updatedAt !== undefined ? toTimestamp(payload.updatedAt, this.now()) : undefined;

    const externalSystem =
      system === "jira" || payload.source === "jira"
        ? "jira"
        : system === "slack" || payload.source === "slack"
          ? "slack"
          : undefined;

    const existingIncident = this.findIncidentForWebhook(
      payload.incidentId?.trim(),
      externalSystem,
      externalId,
    );

    if (existingIncident) {
      if (
        eventKey &&
        existingIncident.timeline.some((event) =>
          (event.correlationKeys || []).includes(`event:${eventKey}`),
        )
      ) {
        return existingIncident;
      }

      const externalRef = externalSystem
        ? this.upsertExternalRef(existingIncident, externalSystem, externalId, payload.url)
        : undefined;

      const lastInboundUpdatedAt = toTimestamp(
        externalRef?.metadata?.lastInboundUpdatedAt,
        0,
      );
      if (inboundUpdatedAt !== undefined && inboundUpdatedAt <= lastInboundUpdatedAt) {
        return existingIncident;
      }

      if (payload.status && payload.status !== existingIncident.status) {
        try {
          this.assertTransition(existingIncident.status, payload.status);
        } catch {
          // External systems can send out-of-band status jumps; accept latest state for sync convergence.
        }
        existingIncident.status = payload.status;
      }
      if (payload.severity) existingIncident.severity = payload.severity;
      if (payload.owner !== undefined) existingIncident.owner = payload.owner;
      if (payload.title?.trim()) existingIncident.title = payload.title.trim();
      if (payload.description !== undefined) {
        existingIncident.description = payload.description;
      }
      if (payload.services?.length) {
        existingIncident.services = normalizeServices(payload.services);
      }

      if (externalRef) {
        externalRef.syncStatus = "success";
        externalRef.lastSyncedAt = this.now();
        externalRef.metadata = toMetadata(externalRef.metadata, payload.metadata, {
          ...(inboundUpdatedAt !== undefined
            ? { lastInboundUpdatedAt: String(inboundUpdatedAt) }
            : {}),
          ...(eventKey ? { lastInboundEventId: eventKey } : {}),
        });
      }

      this.pushTimeline(existingIncident, {
        type: "intake",
        actor: payload.actor || "webhook",
        source: system,
        message: `Webhook update received from ${system}`,
        payload: {
          externalId,
          status: payload.status,
          severity: payload.severity,
        },
        correlationKeys: [
          `${system}:${externalId}`,
          ...(inboundUpdatedAt !== undefined ? [`updatedAt:${inboundUpdatedAt}`] : []),
          ...(eventKey ? [`event:${eventKey}`] : []),
        ],
      });

      await this.persist(existingIncident);
      return existingIncident;
    }

    const incident = await this.createIncident({
      title: payload.title?.trim() || `${system.toUpperCase()} incident ${externalId}`,
      description: payload.description || "Created from external webhook intake",
      severity: payload.severity || "high",
      status: payload.status || "new",
      owner: payload.owner,
      services: payload.services || [],
      source: system,
      actor: payload.actor || "webhook",
      externalRefs: externalSystem
        ? [
            {
              system: externalSystem,
              externalId,
              url: payload.url,
              syncStatus: "success",
              lastSyncedAt: this.now(),
              metadata: toMetadata(payload.metadata, {
                ...(inboundUpdatedAt !== undefined
                  ? { lastInboundUpdatedAt: String(inboundUpdatedAt) }
                  : {}),
                ...(eventKey ? { lastInboundEventId: eventKey } : {}),
              }),
            },
          ]
        : [],
    });

    if (eventKey) {
      const lastEvent = incident.timeline[incident.timeline.length - 1];
      if (lastEvent) {
        lastEvent.correlationKeys = Array.from(
          new Set([
            ...(lastEvent.correlationKeys || []),
            `${system}:${externalId}`,
            ...(inboundUpdatedAt !== undefined ? [`updatedAt:${inboundUpdatedAt}`] : []),
            `event:${eventKey}`,
          ]),
        );
      }
      await this.persist(incident);
    }

    return incident;
  }
}

let incidentService: IncidentService | null = null;

export function getIncidentService(): IncidentService {
  if (!incidentService) {
    incidentService = new IncidentService();
  }
  return incidentService;
}

export function resetIncidentServiceForTests(): void {
  incidentService = null;
}

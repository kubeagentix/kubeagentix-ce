import { RequestHandler } from "express";
import {
  ApproveIncidentActionRequest,
  AttachIncidentDiagnosisRequest,
  CreateIncidentActionRequest,
  CreateIncidentRequest,
  ExecuteIncidentActionRequest,
  ForceIncidentSyncRequest,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  IncidentWebhookRequest,
  ListIncidentsQuery,
  UpdateIncidentRequest,
} from "@shared/incident";
import { getIncidentService, IncidentServiceError } from "../services/incidents";

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function mapIncidentError(error: unknown): { status: number; code: string; message: string } {
  if (!(error instanceof IncidentServiceError)) {
    return {
      status: 500,
      code: "INCIDENT_UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown incident error",
    };
  }

  if (error.code === "INCIDENT_NOT_FOUND") {
    return { status: 404, code: error.code, message: error.message };
  }

  if (
    error.code === "INCIDENT_VALIDATION_ERROR" ||
    error.code === "INCIDENT_INVALID_TRANSITION" ||
    error.code === "INCIDENT_DIAGNOSIS_NOT_FOUND" ||
    error.code === "INCIDENT_ACTION_INVALID" ||
    error.code === "INCIDENT_ACTION_NOT_FOUND"
  ) {
    return { status: 400, code: error.code, message: error.message };
  }

  if (error.code === "INCIDENT_ACTION_NOT_APPROVED") {
    return { status: 403, code: error.code, message: error.message };
  }

  return { status: 500, code: error.code, message: error.message };
}

export const handleCreateIncident: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as CreateIncidentRequest;
    const incident = await getIncidentService().createIncident(payload);
    return res.status(201).json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleListIncidents: RequestHandler = async (req, res) => {
  try {
    const query: ListIncidentsQuery = {
      status: req.query.status as IncidentStatus | undefined,
      severity: req.query.severity as IncidentSeverity | undefined,
      source: req.query.source as IncidentSource | undefined,
      owner: req.query.owner as string | undefined,
      service: req.query.service as string | undefined,
      q: req.query.q as string | undefined,
      limit: toInt(req.query.limit, 50),
      offset: toInt(req.query.offset, 0),
    };

    const result = await getIncidentService().listIncidents(query);
    return res.json(result);
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleGetIncident: RequestHandler = async (req, res) => {
  try {
    const incident = await getIncidentService().getIncidentById(req.params.incidentId);
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleUpdateIncident: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as UpdateIncidentRequest;
    const incident = await getIncidentService().updateIncident(req.params.incidentId, payload);
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleAttachIncidentDiagnosis: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as AttachIncidentDiagnosisRequest;
    const incident = await getIncidentService().attachDiagnosis(req.params.incidentId, payload);
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleCreateIncidentAction: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as CreateIncidentActionRequest;
    const incident = await getIncidentService().createAction(req.params.incidentId, payload);
    return res.status(201).json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleApproveIncidentAction: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as ApproveIncidentActionRequest;
    const incident = await getIncidentService().approveAction(
      req.params.incidentId,
      req.params.actionId,
      payload,
    );
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleExecuteIncidentAction: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as ExecuteIncidentActionRequest;
    const incident = await getIncidentService().executeAction(
      req.params.incidentId,
      req.params.actionId,
      payload,
    );
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleSyncIncidentJira: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as ForceIncidentSyncRequest;
    const incident = await getIncidentService().syncExternal(req.params.incidentId, "jira", payload);
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleSyncIncidentSlack: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as ForceIncidentSyncRequest;
    const incident = await getIncidentService().syncExternal(req.params.incidentId, "slack", payload);
    return res.json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleIncidentJiraWebhook: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as IncidentWebhookRequest;
    const incident = await getIncidentService().ingestWebhook("jira", payload);
    return res.status(202).json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleIncidentSlackWebhook: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as IncidentWebhookRequest;
    const incident = await getIncidentService().ingestWebhook("slack", payload);
    return res.status(202).json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

export const handleIncidentIntakeWebhook: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as IncidentWebhookRequest;
    const incident = await getIncidentService().ingestWebhook("webhook", payload);
    return res.status(202).json({ incident });
  } catch (error) {
    const mapped = mapIncidentError(error);
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }
};

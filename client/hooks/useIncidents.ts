import { useCallback, useState } from "react";
import type {
  ApproveIncidentActionRequest,
  AttachIncidentDiagnosisRequest,
  CreateIncidentActionRequest,
  CreateIncidentRequest,
  ExecuteIncidentActionRequest,
  IncidentCase,
  ListIncidentsResponse,
  UpdateIncidentRequest,
} from "@shared/incident";

async function parseJsonResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as any)?.error?.message ||
      (payload as any)?.message ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as any;
}

export function useIncidents() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withState = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Incident request failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const listIncidents = useCallback(
    async (params?: Record<string, string | number | undefined>) =>
      withState(async () => {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          query.set(key, String(value));
        });

        const response = await fetch(`/api/incidents${query.toString() ? `?${query}` : ""}`);
        const payload = (await parseJsonResponse(response)) as ListIncidentsResponse;
        return payload;
      }),
    [withState],
  );

  const getIncident = useCallback(
    async (incidentId: string) =>
      withState(async () => {
        const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`);
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const createIncident = useCallback(
    async (request: CreateIncidentRequest) =>
      withState(async () => {
        const response = await fetch(`/api/incidents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const updateIncident = useCallback(
    async (incidentId: string, request: UpdateIncidentRequest) =>
      withState(async () => {
        const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const attachDiagnosis = useCallback(
    async (incidentId: string, request: AttachIncidentDiagnosisRequest) =>
      withState(async () => {
        const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/diagnoses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const createAction = useCallback(
    async (incidentId: string, request: CreateIncidentActionRequest) =>
      withState(async () => {
        const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const approveAction = useCallback(
    async (incidentId: string, actionId: string, request: ApproveIncidentActionRequest) =>
      withState(async () => {
        const response = await fetch(
          `/api/incidents/${encodeURIComponent(incidentId)}/actions/${encodeURIComponent(actionId)}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          },
        );
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  const executeAction = useCallback(
    async (incidentId: string, actionId: string, request: ExecuteIncidentActionRequest) =>
      withState(async () => {
        const response = await fetch(
          `/api/incidents/${encodeURIComponent(incidentId)}/actions/${encodeURIComponent(actionId)}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          },
        );
        const payload = (await parseJsonResponse(response)) as { incident: IncidentCase };
        return payload.incident;
      }),
    [withState],
  );

  return {
    loading,
    error,
    listIncidents,
    getIncident,
    createIncident,
    updateIncident,
    attachDiagnosis,
    createAction,
    approveAction,
    executeAction,
  };
}

import { promises as fs } from "fs";
import type { IncidentCase } from "@shared/incident";

export type ObservabilitySignalType = "log" | "metric" | "trace";

export interface ObservabilityEntityHint {
  kind: string;
  name: string;
  namespace?: string;
}

export interface ObservabilityAnomaly {
  id: string;
  signalType: ObservabilitySignalType;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  confidence: number;
  observedAt: number;
  source: string;
  entityHints: ObservabilityEntityHint[];
  metadata?: Record<string, string>;
}

export interface IncidentObservabilityEnrichmentInput {
  incident: IncidentCase;
  clusterContext?: string;
  now: () => number;
}

export interface IncidentObservabilityEnrichmentResult {
  connectorId: string;
  anomalies: ObservabilityAnomaly[];
  warnings: string[];
}

export interface IncidentObservabilityConnector {
  id: string;
  name: string;
  enrich(
    input: IncidentObservabilityEnrichmentInput,
  ): Promise<IncidentObservabilityEnrichmentResult>;
}

type ObservabilityMode = "disabled" | "mock" | "file";

function parseMode(value: string | undefined): ObservabilityMode {
  const normalized = (value || "disabled").trim().toLowerCase();
  if (normalized === "mock" || normalized === "file" || normalized === "disabled") {
    return normalized;
  }
  return "disabled";
}

function buildMockAnomalies(input: IncidentObservabilityEnrichmentInput): ObservabilityAnomaly[] {
  const now = input.now();
  const appEntities = (input.incident.entities || []).filter((entity) =>
    ["pod", "deployment", "service"].includes(entity.kind.toLowerCase()),
  );
  const firstEntity = appEntities[0];
  const firstService = input.incident.services[0];
  const hintName = firstEntity?.name || firstService || "unknown-service";
  const hintNamespace = firstEntity?.namespace;
  const hintKind = firstEntity?.kind || (firstService ? "Service" : "Pod");

  return [
    {
      id: `obs-log-${input.incident.id}`,
      signalType: "log",
      severity: "high",
      message: `Error-rate spike detected in logs for ${hintName}`,
      confidence: 79,
      observedAt: now - 120_000,
      source: "mock-observability",
      entityHints: [{ kind: hintKind, name: hintName, namespace: hintNamespace }],
      metadata: {
        index: "logs-*",
        query: "level:error OR status:5xx",
      },
    },
    {
      id: `obs-metric-${input.incident.id}`,
      signalType: "metric",
      severity: "medium",
      message: `Latency p95 threshold breached for ${hintName}`,
      confidence: 74,
      observedAt: now - 90_000,
      source: "mock-observability",
      entityHints: [{ kind: hintKind, name: hintName, namespace: hintNamespace }],
      metadata: {
        metricName: "http_server_latency_p95",
        value: "1.48",
        threshold: "0.85",
      },
    },
    {
      id: `obs-trace-${input.incident.id}`,
      signalType: "trace",
      severity: "medium",
      message: `Trace anomalies observed on checkout request path`,
      confidence: 70,
      observedAt: now - 60_000,
      source: "mock-observability",
      entityHints: [{ kind: hintKind, name: hintName, namespace: hintNamespace }],
      metadata: {
        traceId: `trace-${input.incident.id.slice(-8)}`,
      },
    },
  ];
}

async function loadAnomaliesFromFile(path: string): Promise<ObservabilityAnomaly[]> {
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw) as { anomalies?: ObservabilityAnomaly[] } | ObservabilityAnomaly[];
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed.anomalies) ? parsed.anomalies : [];
}

export function createIncidentObservabilityConnector(): IncidentObservabilityConnector {
  return {
    id: "observability-v1",
    name: "Observability Connector v1",
    async enrich(input: IncidentObservabilityEnrichmentInput) {
      const mode = parseMode(process.env.INCIDENT_OBSERVABILITY_MODE);
      const warnings: string[] = [];

      if (mode === "disabled") {
        warnings.push("Observability connector disabled");
        return {
          connectorId: "observability-v1",
          anomalies: [],
          warnings,
        };
      }

      if (mode === "mock") {
        return {
          connectorId: "observability-v1",
          anomalies: buildMockAnomalies(input),
          warnings,
        };
      }

      const sourcePath = process.env.INCIDENT_OBSERVABILITY_FILE?.trim();
      if (!sourcePath) {
        warnings.push("INCIDENT_OBSERVABILITY_FILE is not configured");
        return {
          connectorId: "observability-v1",
          anomalies: [],
          warnings,
        };
      }

      try {
        const anomalies = await loadAnomaliesFromFile(sourcePath);
        return {
          connectorId: "observability-v1",
          anomalies: anomalies.map((anomaly) => ({
            ...anomaly,
            observedAt: Number.isFinite(anomaly.observedAt)
              ? anomaly.observedAt
              : input.now(),
            confidence: Math.max(1, Math.min(100, Math.round(anomaly.confidence || 60))),
            entityHints: Array.isArray(anomaly.entityHints) ? anomaly.entityHints : [],
          })),
          warnings,
        };
      } catch (error) {
        warnings.push(
          `Failed to load observability anomalies from file: ${error instanceof Error ? error.message : "unknown error"}`,
        );
        return {
          connectorId: "observability-v1",
          anomalies: [],
          warnings,
        };
      }
    },
  };
}

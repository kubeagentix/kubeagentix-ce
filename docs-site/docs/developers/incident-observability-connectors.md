---
title: Incident Observability Connectors
---

# Incident Observability Connectors

Phase 5 introduces a non-Kubernetes connector interface for incident enrichment.

## Connector Contract

Server interface:

- `IncidentObservabilityConnector`
- file: `server/services/incidentObservability.ts`

Core methods:

- `enrich(input)` returns anomalies + warnings
- never mutate incident state directly in connector code
- return warnings instead of throwing for expected availability gaps

## Anomaly Model

Connectors produce normalized anomalies:

- `signalType`: `log | metric | trace`
- `severity`: `low | medium | high | critical`
- `confidence`: `1..100`
- `entityHints`: target entities to correlate against incident graph
- `metadata`: provider-specific details (metric/query/trace identifiers)

## Integration Path

Connectors are invoked from:

- `IncidentService.investigateIncident()`
- file: `server/services/incidents.ts`

Enrichment behavior:

1. Convert anomalies into `observability`-layer entities.
2. Link anomalies to incident entities using hint matching.
3. Add correlations with `signalId` prefixed by `observability:`.
4. Add graph edges using relationship `observability_detects_entity`.
5. Keep workflow functional when connector data is unavailable.

## Built-in Adapter Modes

Configured via env vars:

- `INCIDENT_OBSERVABILITY_MODE=disabled`
- `INCIDENT_OBSERVABILITY_MODE=mock`
- `INCIDENT_OBSERVABILITY_MODE=file`

File mode expects:

- `INCIDENT_OBSERVABILITY_FILE=/path/to/anomalies.json`

Accepted JSON shapes:

- array of anomalies
- object with `anomalies: []`

## Extension Guidance

To add a real provider adapter (Datadog, New Relic, Elastic, etc.):

1. Implement `IncidentObservabilityConnector`.
2. Translate provider payloads into normalized anomalies.
3. Keep provider-specific fields in `metadata`.
4. Return warnings for transient errors/timeouts.
5. Add service tests for correlation mapping and degraded behavior.

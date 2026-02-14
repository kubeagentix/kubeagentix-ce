---
title: Incident v1 Release Notes
---

# Incident v1 Release Notes

## Release scope

Incident v1 delivers a service/system incident workflow that is distinct from QuickDx:

- QuickDx: fast resource-level diagnosis.
- Incident: case management across blast radius, ownership, timeline, actions, and external comms.

## Included capabilities

1. Incident lifecycle and persistence:
   - lifecycle state machine from intake through resolution.
   - file-backed local storage (`data/incidents`) with cached index.
2. Incident APIs and UX:
   - inbox/list, detail, filtering, updates, and timeline.
   - action proposal, approval, and execution flow.
3. QuickDx integration:
   - create/link incident directly from diagnosis context.
   - attach one or more diagnosis records to an incident.
4. Hybrid external sync:
   - Jira and Slack outbound sync.
   - inbound webhook handling with idempotency and stale update suppression.
5. Layered investigation:
   - Kubernetes-first graph enrichment across edge, app/runtime, platform, network policy, and RBAC.
6. Observability correlation:
   - connector interface and first adapter modes (`disabled`, `mock`, `file`).
   - anomaly-driven entities/correlations and graph edge linkage.

## Operational safeguards

- Human approval gates are mandatory for impactful actions.
- Incident workflows remain functional during external connector failures.
- Investigation degrades gracefully on partial Kubernetes command failures.

## Environment flags

- `INCIDENT_OBSERVABILITY_MODE=disabled|mock|file`
- `INCIDENT_OBSERVABILITY_FILE=/absolute/path/to/anomalies.json` (required for `file` mode)

## Verification checklist used for this release

1. `pnpm -s typecheck`
2. `pnpm -s test server/services/__tests__/incidents.test.ts server/routes/__tests__/incidents.test.ts client/pages/__tests__/Incident.test.tsx`
3. `pnpm -s docs:build`

## Tracking

- Epic: `#1`
- Phase issues: `#2` through `#7` (all completed)

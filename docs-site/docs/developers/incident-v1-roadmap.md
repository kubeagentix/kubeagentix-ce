---
title: Incident v1 Roadmap
---

# Incident v1 Roadmap

## Objective

Deliver a service/system-level Incident workflow that is distinct from QuickDx:

- QuickDx: resource-scoped diagnosis.
- Incident: case management across blast radius, timeline, actions, and communications.

This roadmap follows spec-driven development with phase-gated delivery and explicit acceptance criteria.

## Program Principles

1. Human approval gates are mandatory for impactful actions.
2. Hybrid system-of-record: internal incident record + Jira/Slack external references.
3. Ship in phases, keeping every phase independently releasable.
4. Docs updates are mandatory for behavior changes.

## GitHub Tracking

- Epic: `#1`
- Phase issues:
  - `#2` Phase 0 (Groundwork)
  - `#3` Phase 1 (Foundation APIs/store)
  - `#4` Phase 2 (Incident UX)
  - `#5` Phase 3 (Jira/Slack hybrid sync)
  - `#6` Phase 4 (Layered K8s graph)
  - `#7` Phase 5 (Observability connector)

## Phase Plan

Current status:

- ✅ Phase 0 completed
- ✅ Phase 1 completed
- ✅ Phase 2 completed
- ⏳ Phase 3 not started
- ⏳ Phase 4 not started
- ⏳ Phase 5 not started

## Phase 0: Groundwork and Spec Governance

Scope:

- Define Incident contracts, lifecycle, and acceptance criteria.
- Publish architecture and phased execution plan.
- Set engineering guardrails (AGENTS + hooks + issue structure).

Deliverables:

- Incident roadmap doc.
- Incident architecture/spec doc.
- GitHub epic + phase issues.
- Hook policy for docs updates.

Exit criteria:

- Epic and all phase issues are created and linked.
- Engineering process rules are documented and active.

## Phase 1: Foundation (Backend + Persistence + APIs)

Scope:

- Incident domain model and lifecycle transitions.
- File-backed incident store (`./data/incidents/*.json`, `index.json`) with in-memory cache.
- Inbox/detail CRUD APIs.
- QuickDx diagnosis linking API.
- Action proposal/approval/execute APIs with approval gate enforcement.
- Generic webhook intake endpoint.

Key API surface:

- `POST /api/incidents`
- `GET /api/incidents`
- `GET /api/incidents/:incidentId`
- `PATCH /api/incidents/:incidentId`
- `POST /api/incidents/:incidentId/diagnoses`
- `POST /api/incidents/:incidentId/actions`
- `POST /api/incidents/:incidentId/actions/:actionId/approve`
- `POST /api/incidents/:incidentId/actions/:actionId/execute`
- `POST /api/incidents/intake/webhook`

Exit criteria:

- Incident CRUD works locally with persisted state.
- Execute endpoint rejects unapproved actions.
- QuickDx diagnosis can be attached to an incident.

## Phase 2: Incident UX (Inbox + Detail + Timeline + Actions)

Scope:

- Replace Incident placeholder page with inbox/detail experience.
- Add filtering by status/severity/source/owner.
- Add action panel with approve/execute flow and output history.
- Update QuickDx CTA from view-only to create/link incident.
- Dashboard incident cards read from incident APIs.

Implementation notes:

- Incident page now supports manual incident creation, inbox selection, timeline rendering, and action proposal/approve/execute flow.
- QuickDx now supports incident promotion via create + diagnosis attach and deep-links to the created incident.
- Dashboard now surfaces active incidents and direct navigation into the incident inbox.
- UI tests now cover inbox filter calls, detail/timeline ordering, and approval-gated action flow.

Exit criteria:

- User can create incidents manually and from QuickDx.
- Timeline and action states are visible and persisted.
- UI enforces approve-before-execute semantics.

## Phase 3: Hybrid SoR (Jira + Slack)

Scope:

- Outbound sync endpoints for Jira and Slack.
- Inbound webhook endpoints for Jira and Slack updates.
- External reference tracking and sync status in incident model.
- Idempotent update handling with reconciliation rules.

Key API surface:

- `POST /api/incidents/:incidentId/sync/jira`
- `POST /api/incidents/:incidentId/sync/slack`
- `POST /api/incidents/webhooks/jira`
- `POST /api/incidents/webhooks/slack`

Exit criteria:

- Incident can link and update Jira + Slack references.
- Inbound updates safely reconcile without duplicate mutation.

## Phase 4: Layered Investigation Graph (Kubernetes-First)

Scope:

- Build incident graph across:
  - edge: Ingress/Gateway -> Service/Endpoints
  - app/runtime: workload -> pod
  - platform: node/namespace/events/metrics
  - network/security/rbac: NetworkPolicy + RBAC/can-i checks
- Add correlations and timeline enrichment from graph findings.

Exit criteria:

- Incident detail shows entities, edges, and confidence-backed correlations.
- Graph still degrades gracefully when data is partial.

## Phase 5: Observability Connector (First Non-K8s Layer)

Scope:

- Introduce connector interface and first observability adapter (logs/metrics/traces source).
- Add correlation binding between observability anomalies and incident entities.
- Keep connector contract extensible for cloud/security adapters.

Exit criteria:

- Observability evidence appears in incident timeline/correlation panels.
- Feature works without breaking k8s-only local runtime mode.

## Testing Strategy by Phase

1. Contract tests for shared incident types and lifecycle transition guards.
2. API tests for CRUD, action approval gate, webhook idempotency, and sync behavior.
3. Service tests for graph resolution and failure-mode handling.
4. UI tests for inbox filters, timeline ordering, QuickDx incident promotion, and action flow.
5. E2E scenarios for manual and webhook incidents through mitigation/resolution.

## Release Strategy

- Ship each phase behind small, reviewable PRs.
- Keep migration-free local runtime compatibility.
- Update docs before merge for each completed phase.

## Out of Scope for v1

- Fully autonomous remediation without approval.
- Mandatory external system as sole source of truth.
- Full enterprise multi-tenant control-plane behavior.

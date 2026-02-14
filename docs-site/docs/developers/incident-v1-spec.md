---
title: Incident v1 Specification
---

# Incident v1 Specification

## Problem Statement

QuickDx is optimized for fast diagnosis of a selected Kubernetes resource, but real-world incident response requires:

- service/system-level case ownership,
- cross-entity blast-radius tracking,
- operator-safe action workflow,
- communication and synchronization with external systems.

## Product Positioning

- QuickDx answers: "What is wrong with this resource right now?"
- Incident answers: "How do we coordinate this outage from triage through resolution across systems and teams?"

## Lifecycle

`new -> triage -> investigating -> mitigated -> monitoring -> resolved -> postmortem`

## Core Functional Requirements

1. Create incident from manual input, QuickDx promotion, or webhook intake.
2. Persist and query incidents via inbox/detail APIs.
3. Attach one or more QuickDx diagnosis records to an incident.
4. Propose actions (command/skill/manual), require approval, then allow execution.
5. Maintain ordered timeline events with actor/source metadata.
6. Track external references (Jira issue, Slack thread/channel) with sync status.
7. Model layered entities and correlations to represent blast radius.

## Domain Model (v1)

- Incident case: identity, lifecycle, ownership, severity, services, source, refs, timestamps.
- Entity: typed component with layer classification (edge/app/dependency/platform/infra/network/security/rbac/observability).
- Correlation: weighted link between signals and entities with rationale.
- Graph edge: typed relationship between entities (for example ingress->service->pod).
- Timeline event: immutable case event stream for intake, triage, analysis, actions, sync, and resolution.
- Action: proposal + approval state + execution result and rollback hints.

## Safety Requirements

1. Action execution must fail if approval state is not approved.
2. Command actions must pass existing command policy checks.
3. Execution output must be sanitized/redacted before persistence.
4. Timeline must capture who approved and who executed actions.

## Non-Functional Requirements

1. Local-first CE compatibility with file-backed storage.
2. Deterministic API behavior under missing optional connectors.
3. Idempotent webhook intake and sync updates.
4. Graceful degradation when graph evidence is partial.

## API Contract Targets

- Incident CRUD and list/filter APIs.
- Diagnosis attachment API.
- Action proposal/approval/execute APIs.
- Sync and webhook APIs for Jira/Slack.
- Generic intake webhook API.

## Data and Persistence

- Primary store: `./data/incidents/*.json` + `index.json`.
- In-memory cache with write-through updates.
- External sync cursors and status persisted with incident metadata.

## Layered Graph Scope

Kubernetes-first graph in v1:

- Ingress/Gateway -> Service/Endpoints -> Workload -> Pod
- Platform context: Nodes, namespaces, events, metrics
- Network/security/rbac checks: NetworkPolicy and `kubectl auth can-i`

Observability connector follows as first non-K8s extension.

Extension points:

- Add new graph edge relationships in shared incident contracts.
- Add connector-specific entity builders while preserving partial-data behavior.
- Keep investigation idempotent and additive (enrich entities/correlations, do not erase manual context).

## Acceptance Criteria

1. Manual and QuickDx-based incident creation works.
2. Incident inbox supports filtering and deterministic ordering.
3. Action execution cannot occur without approval.
4. Jira/Slack sync endpoints and webhook intake are idempotent.
5. Graph evidence and correlations are visible on incident detail.
6. Docs are updated for every user-visible behavior change.

---
title: Workspace Evolution
---

# Workspace Evolution (MVP -> Enterprise)

## Current MVP behavior

- UI exposes only:
  - `Cluster`
  - `Default Namespace`
- Namespace in Chat/Terminal is a soft default, not a hard restriction.
- Quick Diagnosis supports explicit namespace filtering with `All namespaces`.

## Internal scope model

The client keeps a canonical scope object:

- `scopeId`
- `clusterContext`
- `workingNamespace`
- `environment`
- optional future fields:
  - `workspaceId`
  - `tenantId`
  - `integrationProfileId`
  - `clientLabel`

Storage key: `kubeagentix_scope_v1`.

## API and contract compatibility

Scope fields are additive and optional in shared contracts. Existing callers remain valid.

Affected contract families:

- Terminal broker contracts
- Agent request context
- RCA request metadata

## Execution semantics

- Broker applies selected cluster context to kubectl execution by default.
- Explicit command flags (for example `--context`) override defaults.
- Command mode does not auto-inject namespace flags.

## Why this design

- Keeps CE user experience lightweight.
- Avoids future contract rework for enterprise multi-client workflows.
- Enables feature-flagged workspace UI later without disruptive backend changes.

## Enterprise activation path (later)

1. Add workspace switcher behind enterprise feature flag.
2. Resolve workspace to connector bindings (K8s/cloud/monitoring/logs/tickets).
3. Enforce tenant/workspace RBAC and audit boundaries at control-plane level.

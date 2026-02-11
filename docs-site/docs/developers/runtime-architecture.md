---
title: Runtime Architecture
---

# KubeAgentiX CE Runtime Architecture

## Runtime model (CE v1)

- Frontend: React SPA
- Backend: local Node/Express API
- Execution: policy-guarded command broker
- Kubernetes data path: brokered `kubectl`
- Browser compute acceleration: WASM helpers (normalization/correlation only)
- Scope model: internal `scopeId + clusterContext + workingNamespace` (workspace-ready)

## Request flow

1. UI calls `/api/*` routes.
2. Route delegates to service layer.
3. Service requests broker execution for privileged operations.
4. Broker evaluates command policy.
5. Allowed commands execute with timeout/output limits and redaction.
6. Normalized data returns to UI and agent/tool flows.

## RCA execution flow

1. Collect baseline evidence (resource status, events, logs, cluster metrics).
2. Build initial heuristic hypotheses and confidence breakdown.
3. Attempt agentic enrichment (strict structured output); never block on provider availability.
4. Run targeted verification iteration for top hypothesis.
5. Re-rank and synthesize final conclusion with supporting/conflicting evidence trace.
6. Return explainability payload (`signals`, `confidenceBreakdown`, synthesis evidence sections).

## Scope semantics

- `Cluster` is an explicit execution/data context selector.
- `Default Namespace` is a soft default for Chat/Terminal suggestions and context hints.
- Explicit query/command scope (for example `-A`, `-n`, `--context`) always overrides defaults.
- Quick Diagnosis uses explicit namespace filtering for targeted RCA.

## Terminal natural-language flow

1. User enters intent in Terminal Natural Language mode.
2. UI calls `POST /api/cli/suggest`.
3. Suggestion service attempts agentic translation, then runs policy preflight.
4. If unavailable/blocked/invalid, heuristic translator provides fallback suggestion.
5. User reviews/edits suggested command.
6. UI calls `POST /api/cli/execute` only after explicit user action.

## Why this architecture

- Keeps privileged ops out of browser.
- Reuses existing kubeconfig/auth plugin behavior via `kubectl`.
- Provides typed, auditable, bounded command execution.
- Keeps CE runtime simple and portable for local-first operator workflows.

## Key boundaries

- Browser/WASM:
  - no privileged execution,
  - deterministic shaping/scoring/correlation only.
- Node broker:
  - all command execution,
  - policy enforcement,
  - audit and redaction.

## Evidence source model (future-ready)

- Scope resolution is already in place to declare which sources are available for a diagnosis.
- CE currently resolves Kubernetes as the active source.
- Enterprise can add source bindings (monitoring/logs/traces/cloud/issue systems) under the same scope contract without changing core UI semantics.

## Future roadmap (out of CE v1 scope)

- Tauri-focused desktop packaging for distribution ergonomics.
- Centralized multi-tenant server and enterprise control planes.
- Optional remote execution fabrics where local CLI assumptions do not hold.

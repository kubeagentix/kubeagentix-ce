---
title: API Reference
---

# KubeAgentiX CE API Reference

Base URL (dev): `http://localhost:4000`

All APIs are namespaced under `/api`.

## Health

### `GET /api/ping`
Simple liveness endpoint.

Response:
```json
{ "message": "pong" }
```

## Agent APIs

### `POST /api/agent/invoke`
Streaming NDJSON agent invocation.

Request body:
- `conversationId: string`
- `userId: string`
- `messages: AgentMessage[]`
- `context: { cluster, namespace, selectedResources, timeRange }`
- optional `toolPreferences`, `modelPreferences`

Streaming chunk types:
- `thinking`
- `tool_call`
- `tool_result`
- `text`
- `complete`
- `error`

### `GET /api/agent/tools`
Returns registered tool definitions.

### `GET /api/agent/conversations/:conversationId`
Returns conversation history.

### `DELETE /api/agent/conversations/:conversationId`
Clears conversation history.

### `POST /api/agent/test-provider`
Tests provider connectivity with user-provided API key.

## CLI / Broker API

### `POST /api/cli/execute`
Executes policy-validated command through broker.

Request:
```json
{
  "command": "kubectl get pods -n default",
  "context": "optional-context",
  "clusterContext": "prod-us-west",
  "scopeId": "local-default",
  "workingNamespace": "default",
  "workspaceId": "optional-future",
  "tenantId": "optional-future",
  "integrationProfileId": "optional-future",
  "namespace": "default",
  "timeoutMs": 15000,
  "maxOutputBytes": 262144
}
```

Success response:
```json
{
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "executedAt": 1739160000000,
  "durationMs": 120,
  "policyDecision": {
    "allowed": true,
    "family": "kubectl",
    "subcommand": "get",
    "matchedRule": "kubectl:get"
  },
  "truncated": false
}
```

Error shape:
```json
{
  "error": {
    "code": "COMMAND_BLOCKED",
    "message": "Subcommand not allowed: apply",
    "retryable": false,
    "policyDecision": {
      "allowed": false,
      "family": "kubectl",
      "subcommand": "apply",
      "reason": "Subcommand not allowed: apply"
    }
  }
}
```

Error codes:
- `COMMAND_BLOCKED`
- `COMMAND_INVALID`
- `COMMAND_FAILED`
- `COMMAND_TIMEOUT`

### `POST /api/cli/suggest`
Translates natural language intent into a safe `kubectl` command suggestion.

Request:
```json
{
  "query": "show non-running pods across all namespaces",
  "context": "prod-us-west",
  "clusterContext": "prod-us-west",
  "scopeId": "local-default",
  "workingNamespace": "default",
  "namespace": "default",
  "recentTerminalContext": [
    { "type": "input", "content": "$ kubectl get pods -n troubled" },
    { "type": "output", "content": "..." }
  ],
  "modelPreferences": {
    "providerId": "gemini",
    "model": "gemini-2.5-flash",
    "apiKey": "optional-local-runtime-key"
  }
}
```

`recentTerminalContext` improves follow-up suggestions (for example, resolving `here` to the last namespace seen in terminal commands).

Deterministic NL intent coverage (heuristic fallback path) includes:
- namespace inventory (`kubectl get namespaces`)
- non-running pods (`kubectl get pods -A --field-selector=status.phase!=Running`)
- pods/deployments combined inventory
- deployments inventory
- services inventory
- nodes inventory
- warning-only events vs all events
- pod logs lookup by pod name

Heuristic intent parsing also normalizes common operator typos (for example `lsit`, `runnig`, `deplyoments`) before mapping.

Success response:
```json
{
  "query": "show non-running pods across all namespaces",
  "suggestedCommand": "kubectl get pods -A --field-selector=status.phase!=Running",
  "source": "heuristic",
  "confidence": 90,
  "rationale": "Detected non-running pod lookup intent.",
  "assumptions": [],
  "warnings": ["Heuristic fallback used."],
  "policyDecision": {
    "allowed": true,
    "family": "kubectl",
    "subcommand": "get",
    "matchedRule": "kubectl:get"
  },
  "generatedAt": 1739160000000
}
```

Error shape:
```json
{
  "error": {
    "code": "SUGGESTION_BLOCKED",
    "message": "Subcommand not allowed: apply",
    "retryable": false,
    "policyDecision": {
      "allowed": false,
      "family": "kubectl",
      "subcommand": "apply",
      "reason": "Subcommand not allowed: apply"
    }
  }
}
```

Suggestion error codes:
- `SUGGESTION_INVALID`
- `SUGGESTION_BLOCKED`
- `SUGGESTION_FAILED`
- `SUGGESTION_UNAVAILABLE`

`SUGGESTION_UNAVAILABLE` is returned for diagnosis-style prompts better suited to Chat (for example, “what's wrong with this pod?”). UI should route users to `/chat` with context handoff.

## Kubernetes Data APIs

### `GET /api/k8s/resources/:resourceType`
Lists normalized resources.

Query params:
- `namespace` (`default`, `all`, etc.)
- `context` (optional kubeconfig context)
- `labelSelector`
- `limit`

### `GET /api/k8s/resources/:resourceType/:name`
Returns detailed resource JSON + YAML.

Query params:
- `namespace`
- `context` (optional kubeconfig context)

### `GET /api/k8s/pods/:podName/logs`
Returns pod logs.

Query params:
- `namespace`
- `context` (optional kubeconfig context)
- `container`
- `lines`
- `since`

### `GET /api/k8s/events`
Returns normalized events.

Query params:
- `namespace`
- `context` (optional kubeconfig context)
- `resourceType`
- `resourceName`
- `limit`

### `GET /api/k8s/metrics`
Returns cluster metrics summary.

Query params:
- `context` (optional kubeconfig context)

### `GET /api/k8s/contexts`
Returns available kubeconfig contexts and current context.

Response:
```json
{
  "contexts": ["prod-us-west", "stage-eu-central"],
  "currentContext": "prod-us-west"
}
```

## RCA APIs

### `POST /api/rca/diagnose`
Runs guided RCA.

Request:
```json
{
  "resource": {
    "kind": "pod",
    "name": "checkout-svc-ghi789",
    "namespace": "production"
  },
  "scopeId": "local-default",
  "clusterContext": "prod-us-west",
  "workingNamespace": "troubled",
  "workspaceId": "optional-future",
  "tenantId": "optional-future",
  "integrationProfileId": "optional-future",
  "useAgentic": true,
  "modelPreferences": {
    "providerId": "claude",
    "model": "claude-3-5-sonnet",
    "apiKey": "optional-local-runtime-key"
  }
}
```

Behavior:
- Hybrid by default:
  - agentic enrichment when provider is configured
  - deterministic heuristic fallback always
- Diagnosis does not fail solely because provider keys are unavailable.
- In CE local runtime, `modelPreferences.apiKey` can be provided to initialize the selected provider for that request (not persisted server-side).
- Hypothesis-driven loop:
  - initial hypothesis ranking from deterministic signals
  - targeted verification iteration for the top hypothesis
  - synthesis of conclusion with support/conflict trace

Response excerpt:
```json
{
  "diagnosisId": "uuid",
  "resource": {
    "kind": "pod",
    "name": "checkout-svc-ghi789",
    "namespace": "production"
  },
  "probableRootCause": "...",
  "hypotheses": [
    {
      "id": "crashloop-config",
      "title": "Application startup/configuration failure",
      "confidence": 92,
      "summary": "..."
    }
  ],
  "signals": [
    {
      "id": "sig-crashloop-state",
      "category": "crashloop",
      "matched": true,
      "detail": "Container waiting reason includes CrashLoopBackOff.",
      "source": "status",
      "severity": "high"
    }
  ],
  "confidenceBreakdown": [
    {
      "hypothesisId": "crashloop-config",
      "base": 72,
      "boosts": [
        {
          "signalId": "sig-crashloop-state",
          "delta": 14,
          "reason": "CrashLoopBackOff state detected"
        }
      ],
      "penalties": [],
      "final": 86
    }
  ],
  "analysisNotes": [
    "Detected 3 matched signal(s) from status/events/logs.",
    "Iteration 1 reinforced pending-mount-config via event + pod volume correlation.",
    "Hypothesis-driven synthesis completed across 3 ranked candidate(s)."
  ],
  "analysisMode": "heuristic",
  "agentic": {
    "attempted": true,
    "used": false,
    "fallbackReason": "No LLM provider configured"
  },
  "generatedAt": 1739160000000
}
```

Important evidence sections returned in `evidence[]`:
- `Targeted Verification Steps`
- `Iteration 1 Findings`
- `Hypothesis Synthesis`
- `Hypothesis Evidence Trace`
- `Correlated Evidence Highlights`
- `Available Evidence Sources`

### `GET /api/rca/diagnose/:diagnosisId`
Retrieves previously generated diagnosis.

## Incident APIs

Incident workflow is service/system scoped (distinct from QuickDx resource-scoped diagnosis).

### `POST /api/incidents`
Create a new incident.

Request excerpt:
```json
{
  "title": "Checkout API elevated 5xx",
  "description": "Detected by on-call from alerts",
  "severity": "high",
  "source": "manual",
  "services": ["checkout", "payments"],
  "owner": "platform-oncall"
}
```

### `GET /api/incidents`
List incident inbox with optional filters.

Query params:
- `status`
- `severity`
- `source`
- `owner`
- `service`
- `q`
- `limit`
- `offset`

### `GET /api/incidents/:incidentId`
Get full incident detail.

### `PATCH /api/incidents/:incidentId`
Update mutable incident fields.

Request excerpt:
```json
{
  "status": "triage",
  "owner": "sre-oncall",
  "actor": "sre-oncall"
}
```

Lifecycle:
`new -> triage -> investigating -> mitigated -> monitoring -> resolved -> postmortem`

### `POST /api/incidents/:incidentId/diagnoses`
Attach an existing QuickDx diagnosis to incident context.

Request:
```json
{
  "diagnosisId": "uuid",
  "attachedBy": "quickdx"
}
```

### `POST /api/incidents/:incidentId/actions`
Create incident action proposal (`command`, `skill`, or `manual`).

### `POST /api/incidents/:incidentId/actions/:actionId/approve`
Approve or reject an action.

### `POST /api/incidents/:incidentId/actions/:actionId/execute`
Execute approved action.

Important:
- Actions requiring approval return `403` if executed before approval.
- Command actions still run through command policy controls.

### `POST /api/incidents/:incidentId/investigate`
Run layered Kubernetes-first investigation graph enrichment for an incident.

Request excerpt:
```json
{
  "actor": "sre-oncall",
  "clusterContext": "prod-us-west",
  "namespace": "checkout",
  "maxEntities": 200
}
```

Response includes:
- updated incident with `entities`, `graphEdges`, and `correlations`
- summary counts (`entityCount`, `edgeCount`, `correlationCount`, `warningCount`)
- warnings for partial-data/degraded paths (without hard failure)

### `POST /api/incidents/:incidentId/sync/jira`
### `POST /api/incidents/:incidentId/sync/slack`
Force external sync and upsert external reference metadata.

Request excerpt:
```json
{
  "actor": "sre-oncall",
  "externalId": "JIRA-221",
  "url": "https://jira.example/browse/JIRA-221",
  "metadata": {
    "component": "checkout"
  }
}
```

Notes:
- Sync mode is controlled by env vars (`INCIDENT_JIRA_SYNC_MODE`, `INCIDENT_SLACK_SYNC_MODE`).
- Failed sync attempts return `502` with `INCIDENT_SYNC_FAILED`, while preserving `syncStatus=failed` for retry visibility.
- Reissuing the same sync endpoint after fixing configuration is the retry path.

### `POST /api/incidents/webhooks/jira`
### `POST /api/incidents/webhooks/slack`
Inbound external updates (idempotent via external reference and event metadata).

Webhook request excerpt:
```json
{
  "incidentId": "inc-optional-local-id",
  "externalId": "JIRA-221",
  "eventId": "evt-9001",
  "updatedAt": 1739160000000,
  "status": "triage",
  "severity": "high",
  "title": "Checkout API elevated 5xx"
}
```

Idempotency strategy:
- Event dedupe by `eventId` when provided.
- Convergence by `incidentId + externalRef + updatedAt` (older `updatedAt` updates are ignored).

### `POST /api/incidents/intake/webhook`
Generic incident intake endpoint for external alert/report sources.

## Skills APIs (Runbooks Replacement)

### `GET /api/skills`
Lists available skill summaries.

### `GET /api/skills/:skillId`
Returns full skill pack definition.

### `POST /api/skills/:skillId/plan`
Builds dry-run execution plan with policy checks.

Request:
```json
{
  "namespace": "default",
  "context": "optional-context",
  "input": {
    "podName": "checkout-svc-ghi789"
  }
}
```

### `POST /api/skills/:skillId/execute`
Executes skill steps (or dry-run).

Request:
```json
{
  "dryRun": true,
  "namespace": "default",
  "input": {
    "podName": "checkout-svc-ghi789"
  }
}
```

Response excerpt:
```json
{
  "skill": {
    "id": "crashloopbackoff-investigation",
    "version": "1.0.0",
    "name": "CrashLoopBackOff Investigation",
    "description": "...",
    "category": "diagnostic",
    "tags": ["rca", "crashloop"]
  },
  "dryRun": true,
  "status": "failed",
  "blockedSteps": 1,
  "steps": [
    {
      "stepId": "blocked-step",
      "title": "Blocked Command",
      "status": "failed",
      "command": "kubectl apply -f manifest.yaml",
      "message": "Subcommand not allowed: apply",
      "errorCode": "COMMAND_BLOCKED",
      "safetyCategory": "policy",
      "blockedReason": "Subcommand not allowed: apply"
    }
  ],
  "successChecks": ["..."],
  "rollbackHints": ["..."]
}
```

Validation errors:
- `SKILL_INPUT_INVALID`
- `SKILL_TEMPLATE_INVALID`

## Shared contracts

Primary shared types:
- `shared/coordination.ts` (agent contracts)
- `shared/terminal.ts` (broker/CLI contracts)
- `shared/rca.ts` (RCA contracts)
- `shared/skills.ts` (skills/runbooks contracts)

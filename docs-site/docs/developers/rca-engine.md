---
title: RCA Engine
---

# RCA Engine (How It Works)

KubeAgentiX CE uses a **hypothesis-driven RCA pipeline** so output is explainable and evidence-backed.

## Design goals

- Deterministic baseline even when no model provider is configured.
- Agentic enrichment when available, without making diagnosis brittle.
- Clear trace from signals -> hypothesis scores -> final conclusion.
- Easy extension path for future data sources (monitoring, logs, tracing, cloud).

## Pipeline

### 1) Initial hypothesis generation

The engine builds a ranked set of initial hypotheses from normalized signals:

- pod status and waiting/termination reasons
- warning events
- log snippets
- scheduling and resource pressure hints

Output at this stage:

- `hypotheses[]`
- `signals[]`
- `confidenceBreakdown[]`

### 2) Targeted evidence iteration

The top hypothesis drives targeted follow-up checks.  
Example for mount/config failures:

1. parse mount-related warning events
2. extract missing Secret/ConfigMap references
3. correlate references with pod volume definitions
4. adjust confidence up/down based on corroboration

This produces:

- `Targeted Verification Steps` evidence item
- `Iteration 1 Findings` evidence item
- confidence adjustments recorded in `confidenceBreakdown`

### 3) Evidence synthesis + conclusion

After targeted iteration, the engine synthesizes:

- primary conclusion from final ranked hypotheses
- competing hypothesis (if confidence gap is small)
- hypothesis trace (support/conflicts)
- correlated event/log highlights

This is returned via:

- `Hypothesis Synthesis`
- `Hypothesis Evidence Trace`
- `Correlated Evidence Highlights`

## Agentic + heuristic interaction

- Heuristic path always runs.
- Agentic path attempts structured enrichment.
- If agent output is invalid/unavailable, diagnosis stays on heuristic with fallback reason.
- Final ranking is synthesis-driven, not raw model output.

## Evidence source awareness

Current CE runtime resolves available sources through internal scope resolution:

- today: Kubernetes connector (`kubectl`-backed local runtime)
- future: monitoring/log/tracing/cloud connectors per workspace profile

Developers should treat connector resolution as the control point for future enterprise evidence expansion.

## What to watch while extending

- Keep new signal matchers specific (avoid broad text matches like generic `not found`).
- Prefer corroboration (2+ independent clues) before strong confidence boosts.
- Add fixture tests for every new scenario and false-positive guardrails.
- Never let model availability decide whether diagnosis can run.

## Key implementation files

- `server/services/rca.ts`
- `server/services/__tests__/rca.test.ts`
- `shared/rca.ts`
- `server/services/scopeResolver.ts`

---
title: Spec-Driven Development
---

KubeAgentiX CE development follows a lightweight spec-first process for medium and large changes.

Recommended flow:
1. Open an issue with problem statement, scope, and acceptance criteria.
2. Add an implementation plan in the issue or linked design note.
3. Build incrementally behind tests.
4. Capture verification evidence (commands, screenshots, and logs).
5. Update user/dev docs with behavior changes before merge.

For high-impact features (RCA logic, command policy, skills execution), include explicit safety and rollback notes in the plan.

## Incident v1 Program

Incident v1 is run as a strict phased epic:

- Roadmap: `/developers/incident-v1-roadmap`
- Spec: `/developers/incident-v1-spec`

Program rules:

1. One GitHub epic tracks the full program.
2. One GitHub issue tracks each phase.
3. Every PR must map to a single active phase.
4. Docs updates are mandatory for user-visible/API-visible changes.

Hook enforcement:

- On `codex/incident-v1` branches, `.githooks/pre-commit` blocks code-only commits that omit docs updates.

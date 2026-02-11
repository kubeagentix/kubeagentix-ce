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

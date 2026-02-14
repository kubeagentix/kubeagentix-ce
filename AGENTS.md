# AGENTS.md

## Purpose

This repository follows spec-driven development for medium and large features.

The Incident v1 program is a strict phased epic and must follow the roadmap and issue structure defined in:

- `docs-site/docs/developers/incident-v1-roadmap.md`
- `docs-site/docs/developers/incident-v1-spec.md`

Program tracker:

- Epic: `#1`
- Phase issues: `#2` to `#7`

## Incident v1 Delivery Rules

1. Work on Incident v1 must happen on branch `codex/incident-v1` or child branches from it.
2. Every implementation PR must map to exactly one active Incident phase issue.
3. Do not start a later phase until the current phase issue acceptance criteria are met.
4. Behavior changes require tests and docs updates in the same PR.
5. Action safety rules (approval gates + policy checks) cannot be bypassed.

## Mandatory Docs Policy

For Incident v1, docs updates are mandatory for any user-visible or API-visible change.

Minimum required docs touch when changing product behavior:

- user docs and/or developer docs under `docs-site/docs/`
- API contract docs if routes or payloads change

The git hook under `.githooks/pre-commit` enforces docs updates when code changes are staged on Incident branches.

## Issue Tracking Policy

1. Maintain one GitHub epic issue for Incident v1.
2. Maintain one GitHub issue per phase.
3. Link PRs to the relevant phase issue.
4. Keep acceptance criteria checklists current in the issue.

## Definition of Done (per phase)

1. Acceptance criteria in the phase issue are checked.
2. Tests for new behavior are present and passing.
3. Docs are updated and build cleanly.
4. Phase summary is posted to the phase issue before closing.

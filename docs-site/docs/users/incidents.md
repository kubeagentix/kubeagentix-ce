---
title: Incident Workflow
---

# Incident Workflow

Incident mode is for service/system-level incident response and coordination.

Use Incident mode when you need to:

- track severity, ownership, and lifecycle state across an outage,
- attach one or more QuickDx diagnoses to a single case,
- keep a timeline of triage/investigation/mitigation updates,
- propose actions and enforce approve-before-execute safety.

## Quick Start

1. Open `/incident`.
2. Create a case with title, optional service, and severity.
3. Move state through lifecycle (`new -> triage -> investigating -> mitigated -> monitoring -> resolved -> postmortem`).
4. Add action proposals (`manual`, `command`, or `skill`), approve them, then execute.

## Promote from QuickDx

After running QuickDx:

1. Click **Create / Link Incident**.
2. KubeAgentiX creates an incident with source `quickdx`.
3. The diagnosis is attached to the incident automatically.
4. You are redirected to the incident detail page.

## Dashboard Integration

The Dashboard shows an **Incident Inbox** panel with active incidents and quick navigation to details.

## Notes

- Action execution requires approval when `requiresApproval=true`.
- Incident data is persisted locally in CE runtime (`./data/incidents`).
- Jira/Slack sync status is persisted on incident external refs (`pending`, `success`, `failed`).
- If external sync fails, fix connector config and retry the same sync endpoint; failures are recoverable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { IncidentService, IncidentServiceError } from "../incidents";

describe("IncidentService", () => {
  let tempDir: string;
  let service: IncidentService;
  const now = vi.fn(() => Date.now());
  const diagnosisLookup = vi.fn();
  const commandExecute = vi.fn();
  const skillExecute = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "incident-service-"));
    now.mockReset();
    now.mockReturnValue(1_700_000_000_000);
    diagnosisLookup.mockReset();
    commandExecute.mockReset();
    skillExecute.mockReset();

    service = new IncidentService({
      dataDir: tempDir,
      now,
      diagnosisLookup,
      commandExecute,
      skillExecute,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates and lists incidents with persisted index", async () => {
    const incident = await service.createIncident({
      title: "Checkout latency spike",
      source: "manual",
      services: ["checkout", "payments"],
      actor: "operator",
    });

    expect(incident.id).toMatch(/^inc-/);
    expect(incident.timeline.length).toBe(1);
    expect(incident.timeline[0].type).toBe("intake");

    const listed = await service.listIncidents({ q: "checkout" });
    expect(listed.total).toBe(1);
    expect(listed.items[0].id).toBe(incident.id);

    const indexRaw = await readFile(path.join(tempDir, "index.json"), "utf8");
    expect(indexRaw).toContain(incident.id);
  });

  it("enforces status transition rules", async () => {
    const incident = await service.createIncident({ title: "Transition test" });

    await expect(
      service.updateIncident(incident.id, {
        status: "mitigated",
        actor: "operator",
      }),
    ).rejects.toMatchObject({
      code: "INCIDENT_INVALID_TRANSITION",
    });
  });

  it("attaches diagnosis from quickdx payload", async () => {
    const incident = await service.createIncident({ title: "Attach diagnosis" });
    diagnosisLookup.mockReturnValue({
      diagnosisId: "diag-1",
      resource: {
        kind: "pod",
        name: "checkout-abc",
        namespace: "prod",
      },
      probableRootCause: "Image pull auth failure",
    });

    const updated = await service.attachDiagnosis(incident.id, {
      diagnosisId: "diag-1",
      attachedBy: "quickdx",
    });

    expect(updated.diagnoses).toHaveLength(1);
    expect(updated.diagnoses[0].diagnosisId).toBe("diag-1");
    expect(updated.timeline.some((event) => event.type === "diagnosis")).toBe(true);
  });

  it("requires approval before executing actions", async () => {
    commandExecute.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      executedAt: 0,
      durationMs: 1,
      policyDecision: { allowed: true, family: "kubectl", subcommand: "get" },
      truncated: false,
    });

    const incident = await service.createIncident({ title: "Approval gate" });
    await service.createAction(incident.id, {
      title: "Inspect pods",
      type: "command",
      command: "kubectl get pods -A",
      proposedBy: "operator",
      requiresApproval: true,
    });

    const actionId = (await service.getIncidentById(incident.id)).actions[0].id;

    await expect(
      service.executeAction(incident.id, actionId, { actor: "operator" }),
    ).rejects.toMatchObject({
      code: "INCIDENT_ACTION_NOT_APPROVED",
    });

    await service.approveAction(incident.id, actionId, { actor: "lead", approved: true });
    const executed = await service.executeAction(incident.id, actionId, { actor: "lead" });

    const action = executed.actions.find((item) => item.id === actionId);
    expect(action?.approvalState).toBe("executed");
    expect(action?.execution?.success).toBe(true);
    expect(commandExecute).toHaveBeenCalledTimes(1);
  });

  it("handles webhook updates idempotently by event id", async () => {
    const created = await service.ingestWebhook("jira", {
      externalId: "JIRA-123",
      title: "Checkout incident",
      status: "new",
      severity: "high",
      eventId: "evt-1",
      actor: "jira",
    });

    expect(created.externalRefs[0]?.externalId).toBe("JIRA-123");

    const updated = await service.ingestWebhook("jira", {
      externalId: "JIRA-123",
      title: "Checkout incident",
      status: "triage",
      severity: "critical",
      eventId: "evt-2",
      actor: "jira",
    });

    const firstEventCount = updated.timeline.length;

    const duplicate = await service.ingestWebhook("jira", {
      externalId: "JIRA-123",
      title: "Checkout incident",
      status: "triage",
      severity: "critical",
      eventId: "evt-2",
      actor: "jira",
    });

    expect(duplicate.timeline.length).toBe(firstEventCount);
    expect(duplicate.status).toBe("triage");
    expect(duplicate.severity).toBe("critical");
  });
});

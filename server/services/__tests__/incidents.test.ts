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

  it("records sync failure state and supports retry recovery", async () => {
    const jiraSync = vi
      .fn()
      .mockRejectedValueOnce(new Error("Jira timeout"))
      .mockResolvedValueOnce({
        externalId: "JIRA-2201",
        url: "https://jira.example/browse/JIRA-2201",
        metadata: { ticketType: "incident" },
      });

    const syncService = new IncidentService({
      dataDir: tempDir,
      now,
      diagnosisLookup,
      commandExecute,
      skillExecute,
      externalSyncAdapters: {
        jira: jiraSync,
      },
    });

    const incident = await syncService.createIncident({ title: "Sync retry test" });

    await expect(
      syncService.syncExternal(incident.id, "jira", {
        actor: "operator",
      }),
    ).rejects.toMatchObject({
      code: "INCIDENT_SYNC_FAILED",
    });

    const failedState = await syncService.getIncidentById(incident.id);
    expect(failedState.externalRefs[0]?.syncStatus).toBe("failed");
    expect(failedState.externalRefs[0]?.metadata?.lastSyncError).toContain("Jira timeout");

    const recovered = await syncService.syncExternal(incident.id, "jira", {
      actor: "operator",
    });
    expect(recovered.externalRefs[0]?.syncStatus).toBe("success");
    expect(recovered.externalRefs[0]?.externalId).toBe("JIRA-2201");
    expect(jiraSync).toHaveBeenCalledTimes(2);
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

  it("applies webhook updates only when updatedAt is newer and supports incidentId targeting", async () => {
    const incident = await service.createIncident({
      title: "Targeted incident",
      source: "manual",
    });

    const linked = await service.ingestWebhook("jira", {
      incidentId: incident.id,
      externalId: "JIRA-900",
      updatedAt: 1_700_000_000_100,
      status: "triage",
      severity: "high",
    });

    expect(linked.id).toBe(incident.id);
    expect(linked.externalRefs[0]?.externalId).toBe("JIRA-900");
    expect(linked.status).toBe("triage");

    const stale = await service.ingestWebhook("jira", {
      incidentId: incident.id,
      externalId: "JIRA-900",
      updatedAt: 1_700_000_000_050,
      status: "resolved",
      severity: "critical",
    });

    expect(stale.status).toBe("triage");
    expect(stale.severity).toBe("high");

    const newer = await service.ingestWebhook("jira", {
      incidentId: incident.id,
      externalId: "JIRA-900",
      updatedAt: 1_700_000_000_200,
      status: "resolved",
      severity: "critical",
    });

    expect(newer.status).toBe("resolved");
    expect(newer.severity).toBe("critical");
  });

  it("builds layered investigation graph across edge/app/platform/rbac", async () => {
    const resourcePayloads: Record<string, { items: any[] }> = {
      "kubectl get ingress -A -o json": {
        items: [
          {
            metadata: { namespace: "prod", name: "checkout-ing" },
            spec: {
              rules: [
                {
                  http: {
                    paths: [
                      { backend: { service: { name: "checkout-svc" } } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      "kubectl get services -A -o json": {
        items: [
          {
            metadata: { namespace: "prod", name: "checkout-svc" },
            spec: { selector: { app: "checkout" } },
          },
        ],
      },
      "kubectl get endpoints -A -o json": {
        items: [{ metadata: { namespace: "prod", name: "checkout-svc" } }],
      },
      "kubectl get deployments -A -o json": {
        items: [
          {
            kind: "Deployment",
            metadata: { namespace: "prod", name: "checkout", labels: { app: "checkout" } },
          },
        ],
      },
      "kubectl get statefulsets -A -o json": { items: [] },
      "kubectl get daemonsets -A -o json": { items: [] },
      "kubectl get pods -A -o json": {
        items: [
          {
            metadata: {
              namespace: "prod",
              name: "checkout-xyz",
              labels: { app: "checkout" },
              ownerReferences: [{ kind: "Deployment", name: "checkout" }],
            },
            spec: { nodeName: "node-a", serviceAccountName: "checkout-sa" },
          },
        ],
      },
      "kubectl get nodes -o json": {
        items: [
          {
            metadata: { name: "node-a" },
            status: { conditions: [{ type: "Ready", status: "True" }] },
          },
        ],
      },
      "kubectl get networkpolicies -A -o json": {
        items: [
          {
            metadata: { namespace: "prod", name: "deny-all" },
            spec: { podSelector: { matchLabels: { app: "checkout" } } },
          },
        ],
      },
      "kubectl get rolebindings -A -o json": {
        items: [
          {
            metadata: { namespace: "prod", name: "checkout-rb" },
            subjects: [{ kind: "ServiceAccount", name: "checkout-sa", namespace: "prod" }],
            roleRef: { name: "view" },
          },
        ],
      },
      "kubectl get clusterrolebindings -o json": { items: [] },
      "kubectl get events -A --field-selector type=Warning -o json": {
        items: [
          {
            metadata: { uid: "evt-1" },
            involvedObject: { kind: "Pod", namespace: "prod", name: "checkout-xyz" },
            reason: "BackOff",
            message: "Back-off restarting failed container",
          },
        ],
      },
    };

    commandExecute.mockImplementation(async ({ command }) => {
      if (String(command).startsWith("kubectl auth can-i")) {
        return {
          stdout: "yes",
          stderr: "",
          exitCode: 0,
          executedAt: 0,
          durationMs: 1,
          policyDecision: { allowed: true, family: "kubectl", subcommand: "auth" },
          truncated: false,
        };
      }

      const payload = resourcePayloads[String(command)];
      if (!payload) {
        return {
          stdout: "{\"items\":[]}",
          stderr: "",
          exitCode: 0,
          executedAt: 0,
          durationMs: 1,
          policyDecision: { allowed: true, family: "kubectl", subcommand: "get" },
          truncated: false,
        };
      }

      return {
        stdout: JSON.stringify(payload),
        stderr: "",
        exitCode: 0,
        executedAt: 0,
        durationMs: 1,
        policyDecision: { allowed: true, family: "kubectl", subcommand: "get" },
        truncated: false,
      };
    });

    const incident = await service.createIncident({
      title: "Layered graph",
      services: ["checkout"],
      entities: [
        {
          id: "pod/prod/checkout-xyz",
          layer: "app",
          kind: "Pod",
          name: "checkout-xyz",
          namespace: "prod",
        },
      ],
    });

    const result = await service.investigateIncident(incident.id, {
      actor: "operator",
      namespace: "prod",
    });

    expect(result.summary.entityCount).toBeGreaterThan(4);
    expect(result.summary.edgeCount).toBeGreaterThan(3);
    expect(result.incident.graphEdges.some((edge) => edge.relationship === "service_targets_pod")).toBe(true);
    expect(result.incident.graphEdges.some((edge) => edge.relationship === "ingress_routes_to_service")).toBe(true);
    expect(result.incident.correlations.length).toBeGreaterThan(0);
  });

  it("degrades layered investigation when kubectl calls fail", async () => {
    commandExecute.mockImplementation(async ({ command }) => {
      if (String(command).includes("pods -A -o json")) {
        return {
          stdout: JSON.stringify({
            items: [
              {
                metadata: { namespace: "prod", name: "checkout-xyz", labels: { app: "checkout" } },
                spec: { nodeName: "node-a", serviceAccountName: "default" },
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
          executedAt: 0,
          durationMs: 1,
          policyDecision: { allowed: true, family: "kubectl", subcommand: "get" },
          truncated: false,
        };
      }

      if (String(command).startsWith("kubectl auth can-i")) {
        throw new Error("kubectl missing auth plugin");
      }

      throw new Error("kubectl unavailable");
    });

    const incident = await service.createIncident({
      title: "Graph fallback",
      entities: [
        {
          id: "pod/prod/checkout-xyz",
          layer: "app",
          kind: "Pod",
          name: "checkout-xyz",
          namespace: "prod",
        },
      ],
    });

    const result = await service.investigateIncident(incident.id, {
      actor: "operator",
      namespace: "prod",
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.summary.entityCount).toBeGreaterThan(0);
    expect(result.incident.timeline.some((event) => event.type === "analysis")).toBe(true);
  });
});

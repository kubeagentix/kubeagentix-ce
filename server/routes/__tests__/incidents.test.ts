import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { AddressInfo } from "net";
import { createServer } from "../../index";
import { resetIncidentServiceForTests } from "../../services/incidents";

describe("Incident routes", () => {
  let tempDir: string;
  let baseUrl: string;
  let server: ReturnType<ReturnType<typeof createServer>["listen"]>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "incident-routes-"));
    process.env.INCIDENT_STORE_DIR = tempDir;
    process.env.INCIDENT_JIRA_SYNC_MODE = "mock";
    process.env.INCIDENT_SLACK_SYNC_MODE = "mock";
    resetIncidentServiceForTests();

    const app = createServer();
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    resetIncidentServiceForTests();
    delete process.env.INCIDENT_STORE_DIR;
    delete process.env.INCIDENT_JIRA_SYNC_MODE;
    delete process.env.INCIDENT_JIRA_WEBHOOK_URL;
    delete process.env.INCIDENT_SLACK_SYNC_MODE;
    delete process.env.INCIDENT_SLACK_WEBHOOK_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("supports create/list/get/update flow", async () => {
    const createResponse = await fetch(`${baseUrl}/api/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Checkout outage",
        severity: "high",
        source: "manual",
      }),
    });

    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as { incident: { id: string } };
    const incidentId = createPayload.incident.id;

    const listResponse = await fetch(`${baseUrl}/api/incidents`);
    const listed = (await listResponse.json()) as { total: number };
    expect(listResponse.status).toBe(200);
    expect(listed.total).toBe(1);

    const getResponse = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "triage",
        owner: "oncall-1",
        actor: "oncall-1",
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as {
      incident: { status: string; owner: string };
    };
    expect(updated.incident.status).toBe("triage");
    expect(updated.incident.owner).toBe("oncall-1");
  });

  it("enforces approval gate on action execution", async () => {
    const create = await fetch(`${baseUrl}/api/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Approval incident" }),
    });
    const incidentId = ((await create.json()) as { incident: { id: string } }).incident.id;

    const actionCreate = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Inspect pods",
        type: "command",
        command: "kubectl get pods -A",
        proposedBy: "operator",
        requiresApproval: true,
      }),
    });

    expect(actionCreate.status).toBe(201);
    const actionPayload = (await actionCreate.json()) as {
      incident: { actions: Array<{ id: string }> };
    };
    const actionId = actionPayload.incident.actions[0].id;

    const execute = await fetch(
      `${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/actions/${encodeURIComponent(actionId)}/execute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "operator" }),
      },
    );

    expect(execute.status).toBe(403);
  });

  it("handles webhook idempotency using event id", async () => {
    const first = await fetch(`${baseUrl}/api/incidents/webhooks/jira`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: "JIRA-221",
        title: "Payment errors",
        eventId: "evt-1",
        status: "new",
      }),
    });

    expect(first.status).toBe(202);
    const firstPayload = (await first.json()) as { incident: { id: string; timeline: any[] } };

    const second = await fetch(`${baseUrl}/api/incidents/webhooks/jira`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: "JIRA-221",
        title: "Payment errors",
        eventId: "evt-1",
        status: "new",
      }),
    });

    expect(second.status).toBe(202);
    const secondPayload = (await second.json()) as { incident: { id: string; timeline: any[] } };
    expect(secondPayload.incident.id).toBe(firstPayload.incident.id);
    expect(secondPayload.incident.timeline.length).toBe(firstPayload.incident.timeline.length);
  });

  it("syncs jira refs and surfaces recoverable failure state", async () => {
    const create = await fetch(`${baseUrl}/api/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Sync incident" }),
    });
    const incidentId = ((await create.json()) as { incident: { id: string } }).incident.id;

    const firstSync = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/sync/jira`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "operator" }),
    });

    expect(firstSync.status).toBe(200);
    const firstPayload = (await firstSync.json()) as {
      incident: { externalRefs: Array<{ syncStatus: string; externalId: string }> };
    };
    expect(firstPayload.incident.externalRefs[0]?.syncStatus).toBe("success");
    expect(firstPayload.incident.externalRefs[0]?.externalId).toMatch(/^JIRA-/);

    process.env.INCIDENT_JIRA_SYNC_MODE = "disabled";
    resetIncidentServiceForTests();

    const failedSync = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/sync/jira`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "operator" }),
    });

    expect(failedSync.status).toBe(502);
    const failedPayload = (await failedSync.json()) as { error: { code: string } };
    expect(failedPayload.error.code).toBe("INCIDENT_SYNC_FAILED");

    const getAfterFailure = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}`);
    const failureState = (await getAfterFailure.json()) as {
      incident: { externalRefs: Array<{ syncStatus: string; metadata?: Record<string, string> }> };
    };
    expect(failureState.incident.externalRefs[0]?.syncStatus).toBe("failed");
    expect(failureState.incident.externalRefs[0]?.metadata?.retryable).toBe("true");
  });

  it("uses updatedAt to ignore stale webhook updates", async () => {
    const first = await fetch(`${baseUrl}/api/incidents/webhooks/slack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: "slack-thread-1",
        updatedAt: 200,
        status: "triage",
        severity: "high",
        title: "Latency thread",
      }),
    });
    expect(first.status).toBe(202);
    const firstPayload = (await first.json()) as { incident: { id: string; status: string } };

    const stale = await fetch(`${baseUrl}/api/incidents/webhooks/slack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incidentId: firstPayload.incident.id,
        externalId: "slack-thread-1",
        updatedAt: 100,
        status: "resolved",
      }),
    });
    expect(stale.status).toBe(202);
    const stalePayload = (await stale.json()) as { incident: { status: string } };
    expect(stalePayload.incident.status).toBe("triage");
  });
});

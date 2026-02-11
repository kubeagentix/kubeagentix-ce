import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    const json = (payload: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });

    if (method === "GET" && url.pathname === "/api/k8s/resources/pod") {
      return json({
        resources: [
          {
            id: "Pod/production/checkout-svc-ghi789",
            name: "checkout-svc-ghi789",
            kind: "Pod",
            namespace: "production",
            status: "warning",
            age: "5m",
            labels: { app: "checkout" },
          },
        ],
        count: 1,
      });
    }

    if (method === "GET" && url.pathname === "/api/k8s/events") {
      return json({
        events: [
          {
            id: "production/backoff",
            type: "warning",
            title: "BackOff",
            description: "Back-off restarting failed container",
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    if (method === "GET" && url.pathname === "/api/k8s/metrics") {
      return json({
        cpu: { usage: 45, total: 100 },
        memory: { usage: 62, total: 100 },
        network: { in: 1.2, out: 1.1 },
        disk: { usage: 55, total: 100 },
        podCount: 22,
        nodeCount: 3,
        deploymentCount: 8,
        serviceCount: 11,
      });
    }

    if (method === "POST" && url.pathname === "/api/rca/diagnose") {
      return json({
        diagnosisId: "diag-1",
        resource: {
          kind: "Pod",
          name: "checkout-svc-ghi789",
          namespace: "production",
        },
        probableRootCause: "Missing DATABASE_URL environment variable.",
        hypotheses: [
          {
            id: "crashloop-config",
            title: "Application startup/configuration failure",
            confidence: 92,
            summary: "Startup dependency env var is missing.",
          },
        ],
        evidence: [
          {
            source: "log",
            title: "Log Snippet",
            detail: "Error: DATABASE_URL not set",
          },
        ],
        recommendations: [
          {
            id: "crashloopbackoff-investigation",
            version: "1.0.0",
            name: "CrashLoopBackOff Investigation",
            description: "Investigate CrashLoopBackOff",
            category: "diagnostic",
            tags: ["rca", "crashloop"],
          },
        ],
        analysisMode: "heuristic",
        agentic: { attempted: true, used: false, fallbackReason: "No LLM provider configured" },
        generatedAt: Date.now(),
      });
    }

    if (method === "GET" && url.pathname === "/api/skills") {
      return json({
        skills: [
          {
            id: "crashloopbackoff-investigation",
            version: "1.0.0",
            name: "CrashLoopBackOff Investigation",
            description: "Investigate CrashLoopBackOff",
            category: "diagnostic",
            tags: ["rca", "crashloop"],
          },
        ],
        count: 1,
      });
    }

    if (method === "GET" && url.pathname === "/api/skills/crashloopbackoff-investigation") {
      return json({
        skill: {
          id: "crashloopbackoff-investigation",
          version: "1.0.0",
          name: "CrashLoopBackOff Investigation",
          description: "Investigate CrashLoopBackOff",
          category: "diagnostic",
          tags: ["rca", "crashloop"],
          inputSchema: [
            { key: "podName", label: "Pod Name", required: true },
            { key: "namespace", label: "Namespace", required: true, defaultValue: "default" },
          ],
          steps: [
            {
              id: "get-pod",
              title: "Inspect Pod Status",
              description: "Fetch pod details",
              type: "command",
              command: "kubectl get pod {{podName}} -n {{namespace}}",
            },
            {
              id: "pod-logs",
              title: "Collect Recent Logs",
              description: "Fetch logs",
              type: "command",
              command: "kubectl logs {{podName}} -n {{namespace}} --tail 120",
            },
          ],
          successChecks: ["Pod phase identified"],
          rollbackHints: ["Diagnostic skill; no rollback needed"],
        },
      });
    }

    if (
      method === "POST" &&
      url.pathname === "/api/skills/crashloopbackoff-investigation/plan"
    ) {
      return json({
        skill: {
          id: "crashloopbackoff-investigation",
          version: "1.0.0",
          name: "CrashLoopBackOff Investigation",
          description: "Investigate CrashLoopBackOff",
          category: "diagnostic",
          tags: ["rca", "crashloop"],
        },
        dryRun: true,
        blockedSteps: 0,
        plan: [
          {
            id: "get-pod",
            title: "Inspect Pod Status",
            description: "Fetch pod details",
            command: "kubectl get pod checkout-svc-ghi789 -n production",
            safe: true,
          },
        ],
      });
    }

    if (
      method === "POST" &&
      url.pathname === "/api/skills/crashloopbackoff-investigation/execute"
    ) {
      return json({
        skill: {
          id: "crashloopbackoff-investigation",
          version: "1.0.0",
          name: "CrashLoopBackOff Investigation",
          description: "Investigate CrashLoopBackOff",
          category: "diagnostic",
          tags: ["rca", "crashloop"],
        },
        dryRun: true,
        status: "success",
        blockedSteps: 0,
        successChecks: ["Pod phase identified"],
        rollbackHints: ["Diagnostic skill; no rollback needed"],
        steps: [
          {
            stepId: "get-pod",
            title: "Inspect Pod Status",
            status: "planned",
            command: "kubectl get pod checkout-svc-ghi789 -n production",
            message: "Ready to execute",
          },
          {
            stepId: "pod-logs",
            title: "Collect Recent Logs",
            status: "planned",
            command: "kubectl logs checkout-svc-ghi789 -n production --tail 120",
            message: "Ready to execute",
          },
        ],
      });
    }

    return json(
      {
        error: {
          code: "MOCK_NOT_CONFIGURED",
          message: `No mock configured for ${method} ${url.pathname}`,
        },
      },
      404,
    );
  });
});

test("dashboard to quickdx to runbooks hero flow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Cluster Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Diagnose Selected" }).click();

  await expect(page).toHaveURL(/\/quick-dx/);
  await expect(page.getByRole("heading", { name: "Quick Diagnosis" })).toBeVisible();

  await page.getByRole("button", { name: "Diagnose This Resource" }).click();

  await expect(page.getByRole("heading", { name: "Probable Root Cause" })).toBeVisible();
  await expect(page.getByText("Analysis mode:")).toBeVisible();

  await page.getByRole("button", { name: "Open Skill Plan" }).click();

  await expect(page).toHaveURL(/\/runbooks/);
  await expect(page.getByText("Execution Progress")).toBeVisible();
  await expect(page.getByText("Success checks:")).toBeVisible();
});

test("runbooks shows blocked-step failure state deterministically", async ({ page }) => {
  await page.route("**/api/skills/crashloopbackoff-investigation/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        skill: {
          id: "crashloopbackoff-investigation",
          version: "1.0.0",
          name: "CrashLoopBackOff Investigation",
          description: "Investigate CrashLoopBackOff",
          category: "diagnostic",
          tags: ["rca", "crashloop"],
        },
        dryRun: true,
        status: "failed",
        blockedSteps: 1,
        successChecks: ["Pod phase identified"],
        rollbackHints: ["Diagnostic skill; no rollback needed"],
        steps: [
          {
            stepId: "blocked-step",
            title: "Blocked Command",
            status: "failed",
            command: "kubectl apply -f manifest.yaml",
            message: "Subcommand not allowed: apply",
            errorCode: "COMMAND_BLOCKED",
            safetyCategory: "policy",
            blockedReason: "Subcommand not allowed: apply",
          },
        ],
      }),
    });
  });

  await page.goto(
    "/runbooks?skill=crashloopbackoff-investigation&kind=Pod&name=checkout-svc-ghi789&namespace=production&diagnosisId=diag-blocked",
  );

  await expect(page.getByText("Execution Progress")).toBeVisible();
  await expect(page.getByText("Subcommand not allowed: apply")).toBeVisible();
  await expect(page.getByText("[COMMAND_BLOCKED]")).toBeVisible();
});

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

    if (method === "POST" && url.pathname === "/api/cli/suggest") {
      return json({
        query: "show non-running pods across all namespaces",
        suggestedCommand:
          "kubectl get pods -A --field-selector=status.phase!=Running",
        source: "heuristic",
        confidence: 90,
        rationale: "Detected non-running pod lookup intent.",
        assumptions: [],
        warnings: ["Heuristic fallback used."],
        policyDecision: {
          allowed: true,
          family: "kubectl",
          subcommand: "get",
          matchedRule: "kubectl:get",
        },
        generatedAt: Date.now(),
      });
    }

    if (method === "POST" && url.pathname === "/api/cli/execute") {
      return json({
        stdout: "No resources found.",
        stderr: "",
        exitCode: 0,
        executedAt: Date.now(),
        durationMs: 53,
        policyDecision: {
          allowed: true,
          family: "kubectl",
          subcommand: "get",
          matchedRule: "kubectl:get",
        },
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

test("natural language terminal mode suggests then executes command", async ({ page }) => {
  await page.goto("/terminal");

  await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await page.getByLabel("Mode").selectOption("natural_language");

  await page
    .getByPlaceholder("Describe what you want to inspect...")
    .fill("show non-running pods across all namespaces");
  await page.getByRole("button", { name: "Suggest command" }).click();

  await expect(page.getByText("Suggested command")).toBeVisible();
  await expect(
    page.locator(
      'input[value="kubectl get pods -A --field-selector=status.phase!=Running"]',
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Execute command" }).click();
  await expect(page.getByText("No resources found.")).toBeVisible();
});

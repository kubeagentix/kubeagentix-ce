import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  executeSkill,
  listSkills,
  planSkill,
  SkillServiceError,
} from "../skills";

describe("skills service", () => {
  it("lists bundled skill packs", async () => {
    const skills = await listSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((skill) => skill.id === "crashloopbackoff-investigation")).toBe(true);
  });

  it("builds dry-run plan for crashloop investigation", async () => {
    const plan = await planSkill("crashloopbackoff-investigation", {
      input: {
        podName: "checkout-svc-ghi789",
        namespace: "default",
      },
      namespace: "default",
    });

    expect(plan).not.toBeNull();
    expect(plan?.plan.length).toBeGreaterThan(0);
    expect(plan?.blockedSteps).toBeGreaterThanOrEqual(0);
    expect(plan?.dryRun).toBe(true);
  });

  it("blocks unsafe interpolated command content", async () => {
    await expect(
      planSkill("crashloopbackoff-investigation", {
        input: {
          podName: "checkout;rm -rf /",
          namespace: "default",
        },
        namespace: "default",
      }),
    ).rejects.toMatchObject({
      code: "SKILL_INPUT_INVALID",
    } satisfies Partial<SkillServiceError>);
  });

  it("fails when required inputs are missing", async () => {
    await expect(
      planSkill("crashloopbackoff-investigation", {
        input: {},
        namespace: "default",
      }),
    ).rejects.toMatchObject({
      code: "SKILL_INPUT_INVALID",
    } satisfies Partial<SkillServiceError>);
  });

  it("executes in dry-run mode without running commands", async () => {
    const result = await executeSkill("pending-pod-analysis", {
      dryRun: true,
      input: {
        podName: "example-pod",
        namespace: "default",
      },
      namespace: "default",
    });

    expect(result).not.toBeNull();
    expect(result?.dryRun).toBe(true);
    expect(result?.steps.length).toBeGreaterThan(0);
    expect(result?.successChecks).toBeDefined();
    expect(result?.rollbackHints).toBeDefined();
  });

  it("returns typed metadata for policy-blocked steps", async () => {
    const tempSkillPath = path.join(process.cwd(), "skills", "zz-policy-block-test.json");
    const tempSkill = {
      id: "policy-block-test",
      version: "1.0.0",
      name: "Policy Block Test",
      description: "Temporary test skill for policy block assertions",
      category: "diagnostic",
      tags: ["test"],
      inputSchema: [
        { key: "namespace", label: "Namespace", required: true, defaultValue: "default" },
      ],
      steps: [
        {
          id: "blocked-step",
          title: "Blocked Command",
          description: "This should be blocked by command policy",
          type: "command",
          command: "kubectl apply -f manifest.yaml -n {{namespace}}",
          onError: "stop",
          timeoutMs: 1000,
        },
      ],
    };

    await fs.writeFile(tempSkillPath, JSON.stringify(tempSkill, null, 2), "utf8");
    try {
      const result = await executeSkill("policy-block-test", {
        dryRun: true,
        input: { namespace: "default" },
        namespace: "default",
      });

      expect(result).not.toBeNull();
      expect(result?.status).toBe("failed");
      expect(result?.steps[0]?.errorCode).toBe("COMMAND_BLOCKED");
      expect(result?.steps[0]?.safetyCategory).toBe("policy");
      expect(result?.steps[0]?.blockedReason).toBeTruthy();
    } finally {
      await fs.unlink(tempSkillPath).catch(() => undefined);
    }
  });
});

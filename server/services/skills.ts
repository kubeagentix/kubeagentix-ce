import { promises as fs } from "fs";
import path from "path";
import {
  SkillExecutionRequest,
  SkillExecutionResponse,
  SkillPack,
  SkillPlanRequest,
  SkillPlanResponse,
  SkillSummary,
} from "@shared/skills";
import { evaluateCommandPolicy } from "../commands/policy";
import { CommandBrokerError, getCommandBroker } from "../commands/broker";

const SKILLS_DIR = path.join(process.cwd(), "skills");
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;
const UNSAFE_INPUT_PATTERN = /[;&|`<>\n\r]/;
const UNSAFE_SUBSTITUTION_PATTERN = /\$\(|\$\{/;
const MAX_INPUT_LENGTH = 200;
const MAX_STEP_OUTPUT_CHARS = 64_000;

export class SkillServiceError extends Error {
  code:
    | "SKILL_INPUT_INVALID"
    | "SKILL_TEMPLATE_INVALID"
    | "SKILL_EXECUTION_BLOCKED"
    | "SKILL_EXECUTION_TIMEOUT";
  issues: string[];

  constructor(
    code: SkillServiceError["code"],
    message: string,
    issues: string[] = [],
  ) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

function summarize(skill: SkillPack): SkillSummary {
  return {
    id: skill.id,
    version: skill.version,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    tags: skill.tags,
  };
}

function sanitizeCommandOutput(output: string | undefined): string | undefined {
  if (!output) return output;

  const redacted = output
    .replace(/(api[_-]?key\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");

  if (redacted.length <= MAX_STEP_OUTPUT_CHARS) {
    return redacted;
  }

  return redacted.slice(0, MAX_STEP_OUTPUT_CHARS) + "\n...[TRUNCATED]";
}

function normalizeInput(input: SkillPlanRequest["input"]): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(input || {})) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }

  return normalized;
}

function validateInputValue(key: string, value: string, issues: string[]) {
  if (!value) return;

  if (value.length > MAX_INPUT_LENGTH) {
    issues.push(`Input '${key}' exceeds max length of ${MAX_INPUT_LENGTH}`);
  }

  if (UNSAFE_INPUT_PATTERN.test(value) || UNSAFE_SUBSTITUTION_PATTERN.test(value)) {
    issues.push(`Input '${key}' contains unsafe shell characters`);
  }
}

function renderCommandTemplate(template: string, values: Record<string, string>): string {
  const missingKeys = new Set<string>();

  const rendered = template.replace(TEMPLATE_TOKEN_PATTERN, (_, key: string) => {
    const replacement = values[key];
    if (replacement === undefined || replacement.trim() === "") {
      missingKeys.add(key);
      return "";
    }
    return replacement;
  });

  if (missingKeys.size > 0) {
    throw new SkillServiceError(
      "SKILL_TEMPLATE_INVALID",
      "Missing template values",
      [`Missing values for: ${Array.from(missingKeys).join(", ")}`],
    );
  }

  return rendered;
}

async function loadSkillFile(filePath: string): Promise<SkillPack | null> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as SkillPack;

  if (!parsed.id || !parsed.name || !Array.isArray(parsed.steps)) {
    return null;
  }

  return parsed;
}

async function loadAllSkills(): Promise<SkillPack[]> {
  const files = await fs.readdir(SKILLS_DIR).catch(() => [] as string[]);
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  const skills = await Promise.all(
    jsonFiles.map(async (file) => loadSkillFile(path.join(SKILLS_DIR, file))),
  );

  return skills.filter((skill): skill is SkillPack => !!skill);
}

export async function listSkills(): Promise<SkillSummary[]> {
  const skills = await loadAllSkills();
  return skills.map(summarize).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkillById(skillId: string): Promise<SkillPack | null> {
  const skills = await loadAllSkills();
  return skills.find((skill) => skill.id === skillId) || null;
}

function buildTemplateValues(
  request: SkillPlanRequest,
  skill: SkillPack,
): Record<string, string> {
  const values: Record<string, string> = {
    namespace: request.namespace || "default",
    context: request.context || "default",
    ...normalizeInput(request.input),
  };

  for (const field of skill.inputSchema || []) {
    if (!(field.key in values) && field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
    }
  }

  return values;
}

function validateSkillInputs(skill: SkillPack, values: Record<string, string>) {
  const issues: string[] = [];

  for (const field of skill.inputSchema || []) {
    const value = values[field.key] || "";
    if (field.required && !value.trim()) {
      issues.push(`Missing required input: ${field.key}`);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    validateInputValue(key, value, issues);
  }

  if (issues.length > 0) {
    throw new SkillServiceError(
      "SKILL_INPUT_INVALID",
      "Invalid skill input",
      issues,
    );
  }
}

export async function planSkill(
  skillId: string,
  request: SkillPlanRequest,
): Promise<SkillPlanResponse | null> {
  const skill = await getSkillById(skillId);
  if (!skill) return null;

  const values = buildTemplateValues(request, skill);
  validateSkillInputs(skill, values);

  const plan = skill.steps.map((step) => {
    if (step.type !== "command" || !step.command) {
      return {
        id: step.id,
        title: step.title,
        description: step.description,
        safe: true,
      };
    }

    const rendered = renderCommandTemplate(step.command, values).trim();
    const { decision } = evaluateCommandPolicy(rendered);

    return {
      id: step.id,
      title: step.title,
      description: step.description,
      command: rendered,
      safe: decision.allowed,
      reason: decision.allowed ? undefined : decision.reason || "Blocked by policy",
    };
  });

  return {
    skill: summarize(skill),
    dryRun: true,
    plan,
    blockedSteps: plan.filter((step) => !step.safe).length,
  };
}

export async function executeSkill(
  skillId: string,
  request: SkillExecutionRequest,
): Promise<SkillExecutionResponse | null> {
  const skill = await getSkillById(skillId);
  if (!skill) return null;

  const dryRun = request.dryRun !== false;
  const plan = await planSkill(skillId, request);
  if (!plan) return null;

  if (dryRun) {
    return {
      skill: summarize(skill),
      dryRun: true,
      status: plan.blockedSteps > 0 ? "failed" : "success",
      blockedSteps: plan.blockedSteps,
      successChecks: skill.successChecks || [],
      rollbackHints: skill.rollbackHints || [],
      steps: plan.plan.map((step) => ({
        stepId: step.id,
        title: step.title,
        status: step.safe ? "planned" : "failed",
        command: step.command,
        message: step.safe ? "Ready to execute" : step.reason,
        errorCode: step.safe ? undefined : "COMMAND_BLOCKED",
        safetyCategory: step.safe ? undefined : "policy",
        blockedReason: step.safe ? undefined : step.reason,
      })),
    };
  }

  if (plan.blockedSteps > 0) {
    return {
      skill: summarize(skill),
      dryRun: false,
      status: "failed",
      blockedSteps: plan.blockedSteps,
      successChecks: skill.successChecks || [],
      rollbackHints: skill.rollbackHints || [],
      steps: plan.plan.map((step) => ({
        stepId: step.id,
        title: step.title,
        status: step.safe ? "planned" : "failed",
        command: step.command,
        message: step.safe ? "Awaiting execution" : step.reason,
        errorCode: step.safe ? undefined : "COMMAND_BLOCKED",
        safetyCategory: step.safe ? undefined : "policy",
        blockedReason: step.safe ? undefined : step.reason,
      })),
    };
  }

  const values = buildTemplateValues(request, skill);
  const results: SkillExecutionResponse["steps"] = [];
  let overallStatus: SkillExecutionResponse["status"] = "success";

  for (const step of skill.steps) {
    if (step.type !== "command" || !step.command) {
      results.push({
        stepId: step.id,
        title: step.title,
        status: "skipped",
        message: "Manual step - execute outside command broker",
      });
      continue;
    }

    const command = renderCommandTemplate(step.command, values).trim();
    const { decision } = evaluateCommandPolicy(command);

    if (!decision.allowed) {
      results.push({
        stepId: step.id,
        title: step.title,
        status: "failed",
        command,
        message: decision.reason || "Blocked by policy",
        errorCode: "COMMAND_BLOCKED",
        safetyCategory: "policy",
        blockedReason: decision.reason || "Blocked by policy",
      });
      overallStatus = "failed";
      if (step.onError !== "continue") break;
      continue;
    }

    try {
      const execution = await getCommandBroker().execute({
        command,
        context: request.context,
        namespace: request.namespace,
        timeoutMs: step.timeoutMs,
      });

      const success = execution.exitCode === 0;
      results.push({
        stepId: step.id,
        title: step.title,
        status: success ? "success" : "failed",
        command,
        stdout: sanitizeCommandOutput(execution.stdout),
        stderr: sanitizeCommandOutput(execution.stderr),
        exitCode: execution.exitCode,
        message: success ? "Command executed" : "Command failed",
        errorCode: success ? undefined : "STEP_EXECUTION_FAILED",
        safetyCategory: success ? undefined : "execution",
      });

      if (!success) {
        overallStatus = "failed";
        if (step.onError !== "continue") break;
      }
    } catch (error) {
      const brokerError =
        error instanceof CommandBrokerError
          ? error
          : new CommandBrokerError(
              "COMMAND_FAILED",
              error instanceof Error ? error.message : "Command execution failed",
              true,
            );

      results.push({
        stepId: step.id,
        title: step.title,
        status: "failed",
        command,
        stderr: sanitizeCommandOutput(brokerError.message),
        message: brokerError.message,
        errorCode: brokerError.code,
        safetyCategory:
          brokerError.code === "COMMAND_BLOCKED" ? "policy" : "execution",
        blockedReason:
          brokerError.code === "COMMAND_BLOCKED"
            ? brokerError.message
            : undefined,
      });
      overallStatus = "failed";
      if (step.onError !== "continue") break;
    }
  }

  return {
    skill: summarize(skill),
    dryRun: false,
    status: overallStatus,
    blockedSteps: 0,
    successChecks: skill.successChecks || [],
    rollbackHints: skill.rollbackHints || [],
    steps: results,
  };
}

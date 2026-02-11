export type SkillCategory = "diagnostic" | "remediation" | "maintenance";

export type SkillStepType = "command" | "manual";

export interface SkillInputField {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface SkillStep {
  id: string;
  title: string;
  description: string;
  type: SkillStepType;
  command?: string;
  onError?: "stop" | "continue";
  timeoutMs?: number;
}

export interface SkillPack {
  id: string;
  version: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  triggers?: string[];
  inputSchema?: SkillInputField[];
  steps: SkillStep[];
  successChecks?: string[];
  rollbackHints?: string[];
}

export interface SkillSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
}

export interface SkillPlanStep {
  id: string;
  title: string;
  description: string;
  command?: string;
  safe: boolean;
  reason?: string;
}

export interface SkillPlanRequest {
  input?: Record<string, string>;
  context?: string;
  namespace?: string;
}

export interface SkillPlanResponse {
  skill: SkillSummary;
  dryRun: true;
  plan: SkillPlanStep[];
  blockedSteps: number;
}

export interface SkillExecutionRequest extends SkillPlanRequest {
  dryRun?: boolean;
}

export interface SkillExecutionStepResult {
  stepId: string;
  title: string;
  status: "planned" | "success" | "failed" | "skipped";
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  message?: string;
  errorCode?:
    | "COMMAND_BLOCKED"
    | "COMMAND_INVALID"
    | "COMMAND_FAILED"
    | "COMMAND_TIMEOUT"
    | "SKILL_INPUT_INVALID"
    | "SKILL_TEMPLATE_INVALID"
    | "STEP_EXECUTION_FAILED";
  safetyCategory?: "policy" | "validation" | "execution";
  blockedReason?: string;
}

export interface SkillExecutionResponse {
  skill: SkillSummary;
  dryRun: boolean;
  status: "success" | "failed";
  steps: SkillExecutionStepResult[];
  blockedSteps?: number;
  successChecks?: string[];
  rollbackHints?: string[];
}

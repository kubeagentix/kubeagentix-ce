/**
 * Runbook and Execution Types
 */

export interface Runbook {
  id: string;
  name: string;
  description: string;
  category: "diagnostic" | "remediation" | "maintenance";
  steps: RunbookStep[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastExecuted?: number;
  successRate?: number;
}

export interface RunbookStep {
  id: string;
  title: string;
  description: string;
  type: "manual" | "automated" | "approval";
  command?: string;
  expectedOutput?: string;
  timeout?: number;
  retryable?: boolean;
}

export interface RunbookExecution {
  id: string;
  runbookId: string;
  startedAt: number;
  completedAt?: number;
  status: "pending" | "running" | "completed" | "failed";
  currentStep: number;
  steps: ExecutionStepResult[];
  output: string[];
  error?: string;
}

export interface ExecutionStepResult {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
}

export interface RunbookTemplate {
  name: string;
  category: string;
  steps: Array<{
    title: string;
    command: string;
    description: string;
  }>;
}

import { useState, useCallback, useEffect } from "react";
import { SkillExecutionResponse } from "@shared/skills";

export interface ExecutionStep {
  step: number;
  name: string;
  status: "complete" | "pending" | "current" | "failed";
  output?: string;
  error?: string;
}

export interface IncidentExecutionSnapshot {
  diagnosisId?: string;
  runbookId: string;
  executionId: string;
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  steps: ExecutionStep[];
  output: string[];
  dryRun?: boolean;
  error?: string;
  updatedAt: number;
}

interface RunbookExecutionState {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  steps: ExecutionStep[];
  output: string[];
  error?: string;
  dryRun?: boolean;
}

const INCIDENT_EXECUTION_KEY_PREFIX = "kubeagentix_incident_execution:";
const LAST_INCIDENT_EXECUTION_KEY = "kubeagentix_incident_execution:last";

function persistExecutionSnapshot(snapshot: IncidentExecutionSnapshot) {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify(snapshot);
  if (snapshot.diagnosisId) {
    sessionStorage.setItem(`${INCIDENT_EXECUTION_KEY_PREFIX}${snapshot.diagnosisId}`, payload);
  }
  sessionStorage.setItem(LAST_INCIDENT_EXECUTION_KEY, payload);
}

export function getIncidentExecutionSnapshot(
  diagnosisId?: string | null,
): IncidentExecutionSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    if (diagnosisId) {
      const byDiagnosis = sessionStorage.getItem(
        `${INCIDENT_EXECUTION_KEY_PREFIX}${diagnosisId}`,
      );
      if (byDiagnosis) {
        return JSON.parse(byDiagnosis) as IncidentExecutionSnapshot;
      }
    }

    const latest = sessionStorage.getItem(LAST_INCIDENT_EXECUTION_KEY);
    return latest ? (JSON.parse(latest) as IncidentExecutionSnapshot) : null;
  } catch {
    return null;
  }
}

export function useRunbookExecution(runbookId: string) {
  const [execution, setExecution] = useState<RunbookExecutionState | null>(null);

  const applyExecutionResponse = useCallback((
    execId: string,
    data: SkillExecutionResponse,
    diagnosisId?: string,
  ) => {
    const completedSteps = data.steps.filter((step) => step.status === "success").length;
    const progress =
      data.steps.length === 0 ? 100 : Math.round((completedSteps / data.steps.length) * 100);

    const mappedSteps: ExecutionStep[] = data.steps.map((step, index) => ({
      step: index + 1,
      name: step.title,
      status:
        step.status === "success"
          ? "complete"
          : step.status === "failed"
            ? "failed"
            : "pending",
      output: step.stdout || step.message,
      error: step.stderr || (step.status === "failed" ? step.message : undefined),
    }));

    const outputLines = data.steps.flatMap((step) => {
      const lines: string[] = [];
      if (step.command) lines.push(`$ ${step.command}`);
      if (step.errorCode) lines.push(`[${step.errorCode}]`);
      if (step.stdout) lines.push(step.stdout);
      if (step.stderr) lines.push(step.stderr);
      if (!step.stdout && !step.stderr && step.message) lines.push(step.message);
      return lines;
    });

    if (data.successChecks?.length) {
      outputLines.push("Success checks:");
      data.successChecks.forEach((check) => outputLines.push(`- ${check}`));
    }

    if (data.rollbackHints?.length) {
      outputLines.push("Rollback hints:");
      data.rollbackHints.forEach((hint) => outputLines.push(`- ${hint}`));
    }

    const nextExecution: RunbookExecutionState = {
      id: execId,
      status: data.status === "success" ? "completed" : "failed",
      progress,
      steps: mappedSteps,
      output: outputLines,
      dryRun: data.dryRun,
      error: data.status === "failed" ? "Skill execution failed" : undefined,
    };

    setExecution(nextExecution);
    persistExecutionSnapshot({
      diagnosisId,
      runbookId,
      executionId: execId,
      status: nextExecution.status,
      progress: nextExecution.progress,
      steps: nextExecution.steps,
      output: nextExecution.output,
      dryRun: nextExecution.dryRun,
      error: nextExecution.error,
      updatedAt: Date.now(),
    });
  }, [runbookId]);

  const startExecution = useCallback(async (opts?: {
    dryRun?: boolean;
    input?: Record<string, string>;
    namespace?: string;
    diagnosisId?: string;
  }) => {
    const execId = `exec-${Date.now()}`;
    setExecution({
      id: execId,
      status: "running",
      progress: 0,
      steps: [],
      output: [],
      dryRun: opts?.dryRun !== false,
    });

    try {
      const response = await fetch(`/api/skills/${encodeURIComponent(runbookId)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: opts?.dryRun !== false,
          input: opts?.input || {},
          namespace: opts?.namespace,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const issues = Array.isArray(data?.error?.issues)
          ? `: ${data.error.issues.join("; ")}`
          : "";
        throw new Error(
          `${data?.error?.message || `Execution failed (${response.status})`}${issues}`,
        );
      }

      applyExecutionResponse(execId, data as SkillExecutionResponse, opts?.diagnosisId);
    } catch (error) {
      const failedExecution: RunbookExecutionState = {
        id: execId,
        status: "failed",
        progress: 0,
        steps: [],
        output: [],
        error: error instanceof Error ? error.message : "Execution failed",
      };
      setExecution(failedExecution);
      persistExecutionSnapshot({
        diagnosisId: opts?.diagnosisId,
        runbookId,
        executionId: execId,
        status: failedExecution.status,
        progress: failedExecution.progress,
        steps: failedExecution.steps,
        output: failedExecution.output,
        dryRun: opts?.dryRun !== false,
        error: failedExecution.error,
        updatedAt: Date.now(),
      });
    }
  }, [applyExecutionResponse, runbookId]);

  const executeStep = useCallback(
    async (stepNum: number, approved: boolean = false) => {
      if (!execution) return;
      setExecution((prev) =>
        prev
          ? {
              ...prev,
              output: [
                ...prev.output,
                `Manual step ${stepNum} ${approved ? "approved" : "recorded"}`,
              ],
            }
          : null,
      );
    },
    [execution],
  );

  const stopExecution = useCallback(() => {
    setExecution(null);
  }, []);

  useEffect(() => {
    setExecution(null);
  }, [runbookId]);

  return {
    execution,
    startExecution,
    executeStep,
    stopExecution,
  };
}

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Play,
  CheckCircle,
  Zap,
  Wrench,
  Hammer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSkills, useSkillDetail } from "@/hooks/useSkills";
import { useRunbookExecution } from "@/hooks/useRunbookExecution";

interface SkillCategoryGroup {
  name: string;
  icon: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

const runbookIconMap: Record<string, React.ReactNode> = {
  zap: <Zap className="w-6 h-6 text-orange-400" />,
  wrench: <Wrench className="w-6 h-6 text-orange-400" />,
  hammer: <Hammer className="w-6 h-6 text-orange-400" />,
};

function categoryTitle(category: string): string {
  if (category === "diagnostic") return "Diagnostic";
  if (category === "remediation") return "Remediation";
  return "Maintenance";
}

function categoryIcon(category: string): string {
  if (category === "diagnostic") return "zap";
  if (category === "remediation") return "wrench";
  return "hammer";
}

export default function Runbooks() {
  const [searchParams] = useSearchParams();
  const initialSkillId = searchParams.get("skill");
  const resourceName = searchParams.get("name") || "";
  const resourceNamespace = searchParams.get("namespace") || "";
  const resourceKind = (searchParams.get("kind") || "").toLowerCase();
  const diagnosisId = searchParams.get("diagnosisId") || undefined;

  const [search, setSearch] = useState("");
  const [executingRunbook, setExecutingRunbook] = useState<string | null>(
    initialSkillId || null,
  );

  const { skills, loading, error } = useSkills();
  const { skill, createPlan, error: skillDetailError } = useSkillDetail(executingRunbook);
  const { execution, startExecution } = useRunbookExecution(executingRunbook || "");

  const categories = useMemo<SkillCategoryGroup[]>(() => {
    const filtered = skills.filter((skillEntry) =>
      skillEntry.name.toLowerCase().includes(search.toLowerCase()),
    );

    const groups: Record<string, SkillCategoryGroup> = {};
    for (const skillEntry of filtered) {
      const key = skillEntry.category;
      if (!groups[key]) {
        groups[key] = {
          name: categoryTitle(skillEntry.category),
          icon: categoryIcon(skillEntry.category),
          skills: [],
        };
      }

      groups[key].skills.push({
        id: skillEntry.id,
        name: skillEntry.name,
        description: skillEntry.description,
      });
    }

    return ["diagnostic", "remediation", "maintenance"]
      .filter((key) => groups[key])
      .map((key) => groups[key]);
  }, [search, skills]);

  const derivedSkillInput = useMemo(() => {
    if (!skill) return {};

    const values: Record<string, string> = {};
    for (const field of skill.inputSchema || []) {
      if (field.defaultValue) {
        values[field.key] = field.defaultValue;
        continue;
      }

      const key = field.key.toLowerCase();
      if (key === "namespace" && resourceNamespace) {
        values[field.key] = resourceNamespace;
        continue;
      }

      if (resourceName) {
        if (key.includes("pod") && resourceKind === "pod") {
          values[field.key] = resourceName;
          continue;
        }
        if (key.includes("deployment") && resourceKind === "deployment") {
          values[field.key] = resourceName;
          continue;
        }
      }
    }

    return values;
  }, [resourceKind, resourceName, resourceNamespace, skill]);

  useEffect(() => {
    if (!executingRunbook) return;
    if (execution) return;
    if (!skill) return;

    void (async () => {
      try {
        const namespace =
          derivedSkillInput.namespace || resourceNamespace || "default";
        await createPlan(derivedSkillInput, namespace);
        await startExecution({
          dryRun: true,
          namespace,
          input: derivedSkillInput,
          diagnosisId,
        });
      } catch {
        // Execution errors are surfaced via hook state.
      }
    })();
  }, [
    createPlan,
    derivedSkillInput,
    executingRunbook,
    execution,
    resourceNamespace,
    skill,
    startExecution,
    diagnosisId,
  ]);

  const steps = useMemo(() => {
    if (execution?.steps?.length) {
      return execution.steps.map((step) => ({
        step: step.step,
        name: step.name,
        status:
          step.status === "complete"
            ? "complete"
            : step.status === "failed"
              ? "failed"
              : "current",
      }));
    }

    if (skill?.steps?.length) {
      return skill.steps.map((step, index) => ({
        step: index + 1,
        name: step.title,
        status: index === 0 ? "current" : "pending",
      }));
    }

    return [];
  }, [execution?.steps, skill?.steps]);

  const progress = execution?.progress ?? 0;

  const latestOutput = useMemo(() => {
    if (execution?.output?.length) {
      return execution.output.slice(-8);
    }
    return ["Preparing skill execution..."];
  }, [execution?.output]);

  return (
    <AppShell mode="runbooks">
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Runbooks</h1>
        <p className="text-zinc-400 mb-6">
          Execute and manage operational runbooks
        </p>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}
        {skillDetailError && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {skillDetailError}
          </div>
        )}

        {!executingRunbook ? (
          <>
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                <Input
                  placeholder="Search runbooks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
            </div>

            {loading ? (
              <div className="text-zinc-400">Loading runbooks...</div>
            ) : (
              <div className="space-y-6">
                {categories.map((category) => (
                  <div key={category.name}>
                    <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      {runbookIconMap[category.icon] || (
                        <Zap className="w-5 h-5 text-orange-400" />
                      )}
                      {category.name}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {category.skills.map((runbook) => (
                        <div
                          key={runbook.id}
                          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-orange-700/50 transition-colors"
                        >
                          <h3 className="font-medium text-white mb-2">{runbook.name}</h3>
                          <p className="text-sm text-zinc-400 mb-4">{runbook.description}</p>
                          <Button
                            onClick={() => setExecutingRunbook(runbook.id)}
                            className="w-full bg-orange-700 hover:bg-orange-800 text-white text-sm"
                          >
                            <Play className="w-3 h-3 mr-2" />
                            Execute
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">
                Running: {skill?.name || "Skill Execution"}
              </h2>
              <Button
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={() => setExecutingRunbook(null)}
              >
                Back to Library
              </Button>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-6">Execution Progress</h3>

              <div className="space-y-4 mb-6">
                {steps.map((step) => (
                  <div key={step.step} className="flex items-start gap-4">
                    <div className="flex-shrink-0 pt-1">
                      {step.status === "complete" ? (
                        <CheckCircle className="w-6 h-6 text-green-500" />
                      ) : step.status === "failed" ? (
                        <div className="w-6 h-6 bg-red-700 rounded-full" />
                      ) : step.status === "current" ? (
                        <div className="w-6 h-6 bg-orange-700 rounded-full animate-pulse" />
                      ) : (
                        <div className="w-6 h-6 border-2 border-zinc-700 rounded-full" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div
                        className={`font-medium ${
                          step.status === "current"
                            ? "text-orange-400"
                            : step.status === "complete"
                              ? "text-green-400"
                              : step.status === "failed"
                                ? "text-red-400"
                              : "text-zinc-400"
                        }`}
                      >
                        Step {step.step}: {step.name}
                      </div>
                      {step.status === "current" && (
                        <div className="mt-2 text-sm text-zinc-400">Running analysis...</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-zinc-300">Progress</span>
                  <span className="text-sm text-zinc-500">{progress}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div
                    className="bg-orange-700 h-2 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
                <h4 className="text-sm font-semibold text-white mb-2">Latest Output</h4>
                <div className="font-mono text-xs text-zinc-400 space-y-1 max-h-48 overflow-y-auto">
                  {latestOutput.map((line, idx) => (
                    <div
                      key={`${idx}-${line.slice(0, 20)}`}
                      className={line.toLowerCase().includes("error") ? "text-red-400" : ""}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

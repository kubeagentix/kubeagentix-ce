import { useCallback, useEffect, useState } from "react";
import { SkillPack, SkillPlanResponse, SkillSummary } from "@shared/skills";

export function useSkills() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/skills");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || `Failed to fetch skills (${response.status})`);
      }

      setSkills(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return {
    skills,
    loading,
    error,
    refetch: fetchSkills,
  };
}

export function useSkillDetail(skillId?: string | null) {
  const [skill, setSkill] = useState<SkillPack | null>(null);
  const [plan, setPlan] = useState<SkillPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSkill = useCallback(async () => {
    if (!skillId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `Failed to fetch skill (${response.status})`);
      }
      setSkill(data.skill || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch skill");
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  const createPlan = useCallback(
    async (input?: Record<string, string>, namespace?: string) => {
      if (!skillId) return null;

      const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: input || {}, namespace }),
      });

      const data = await response.json();
      if (!response.ok) {
        const issues = Array.isArray(data?.error?.issues)
          ? `: ${data.error.issues.join("; ")}`
          : "";
        throw new Error(
          `${data?.error?.message || `Failed to create plan (${response.status})`}${issues}`,
        );
      }

      setPlan(data as SkillPlanResponse);
      return data as SkillPlanResponse;
    },
    [skillId],
  );

  useEffect(() => {
    fetchSkill();
  }, [fetchSkill]);

  return {
    skill,
    plan,
    loading,
    error,
    refetch: fetchSkill,
    createPlan,
  };
}

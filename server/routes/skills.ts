import { RequestHandler } from "express";
import {
  executeSkill,
  getSkillById,
  listSkills,
  planSkill,
  SkillServiceError,
} from "../services/skills";
import { SkillExecutionRequest, SkillPlanRequest } from "@shared/skills";

export const handleListSkills: RequestHandler = async (_req, res) => {
  try {
    const skills = await listSkills();
    res.json({ skills, count: skills.length });
  } catch (error) {
    res.status(500).json({
      error: {
        code: "SKILLS_LIST_ERROR",
        message: error instanceof Error ? error.message : "Failed to list skills",
      },
    });
  }
};

export const handleGetSkill: RequestHandler = async (req, res) => {
  try {
    const skill = await getSkillById(req.params.skillId);
    if (!skill) {
      return res.status(404).json({
        error: {
          code: "SKILL_NOT_FOUND",
          message: `Skill not found: ${req.params.skillId}`,
        },
      });
    }

    return res.json({ skill });
  } catch (error) {
    return res.status(500).json({
      error: {
        code: "SKILL_GET_ERROR",
        message: error instanceof Error ? error.message : "Failed to get skill",
      },
    });
  }
};

export const handlePlanSkill: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as SkillPlanRequest;
    const plan = await planSkill(req.params.skillId, payload);

    if (!plan) {
      return res.status(404).json({
        error: {
          code: "SKILL_NOT_FOUND",
          message: `Skill not found: ${req.params.skillId}`,
        },
      });
    }

    return res.json(plan);
  } catch (error) {
    if (error instanceof SkillServiceError) {
      const status =
        error.code === "SKILL_EXECUTION_BLOCKED"
          ? 403
          : error.code === "SKILL_EXECUTION_TIMEOUT"
            ? 408
            : 400;
      return res.status(status).json({
        error: {
          code: error.code,
          message: error.message,
          issues: error.issues,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: "SKILL_PLAN_ERROR",
        message: error instanceof Error ? error.message : "Failed to plan skill",
      },
    });
  }
};

export const handleExecuteSkill: RequestHandler = async (req, res) => {
  try {
    const payload = (req.body || {}) as SkillExecutionRequest;
    const result = await executeSkill(req.params.skillId, payload);

    if (!result) {
      return res.status(404).json({
        error: {
          code: "SKILL_NOT_FOUND",
          message: `Skill not found: ${req.params.skillId}`,
        },
      });
    }

    return res.json(result);
  } catch (error) {
    if (error instanceof SkillServiceError) {
      const status =
        error.code === "SKILL_EXECUTION_BLOCKED"
          ? 403
          : error.code === "SKILL_EXECUTION_TIMEOUT"
            ? 408
            : 400;
      return res.status(status).json({
        error: {
          code: error.code,
          message: error.message,
          issues: error.issues,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: "SKILL_EXECUTE_ERROR",
        message: error instanceof Error ? error.message : "Failed to execute skill",
      },
    });
  }
};

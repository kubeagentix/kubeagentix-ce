import { RequestHandler } from "express";
import { RcaDiagnoseRequest } from "@shared/rca";
import { diagnoseResource, getDiagnosisById } from "../services/rca";

export const handleDiagnoseResource: RequestHandler = async (req, res) => {
  try {
    const payload = req.body as RcaDiagnoseRequest;

    if (!payload?.resource?.kind || !payload?.resource?.name || !payload?.resource?.namespace) {
      return res.status(400).json({
        error: {
          code: "RCA_INVALID_REQUEST",
          message: "resource.kind, resource.name and resource.namespace are required",
        },
      });
    }

    const diagnosis = await diagnoseResource(payload);
    return res.json(diagnosis);
  } catch (error) {
    return res.status(500).json({
      error: {
        code: "RCA_DIAGNOSE_ERROR",
        message: error instanceof Error ? error.message : "Failed to diagnose resource",
      },
    });
  }
};

export const handleGetDiagnosis: RequestHandler = (req, res) => {
  const diagnosis = getDiagnosisById(req.params.diagnosisId);

  if (!diagnosis) {
    return res.status(404).json({
      error: {
        code: "RCA_NOT_FOUND",
        message: `Diagnosis not found: ${req.params.diagnosisId}`,
      },
    });
  }

  return res.json(diagnosis);
};

import { useCallback, useState } from "react";
import { RcaDiagnoseResponse, RcaResourceRef } from "@shared/rca";
import { useWorkspaceScope } from "@/lib/workspaceScope";

export function useRcaDiagnosis() {
  const scope = useWorkspaceScope();
  const [diagnosis, setDiagnosis] = useState<RcaDiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diagnose = useCallback(async (resource: RcaResourceRef) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/rca/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resource,
          useAgentic: true,
          scopeId: scope.scopeId,
          clusterContext: scope.clusterContext,
          workingNamespace: scope.workingNamespace,
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          integrationProfileId: scope.integrationProfileId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `Diagnosis failed (${response.status})`);
      }

      setDiagnosis(data as RcaDiagnoseResponse);
      return data as RcaDiagnoseResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnosis failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, [
    scope.clusterContext,
    scope.integrationProfileId,
    scope.scopeId,
    scope.tenantId,
    scope.workingNamespace,
    scope.workspaceId,
  ]);

  const fetchDiagnosis = useCallback(async (diagnosisId: string) => {
    const response = await fetch(`/api/rca/diagnose/${encodeURIComponent(diagnosisId)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || `Failed to load diagnosis (${response.status})`);
    }

    setDiagnosis(data as RcaDiagnoseResponse);
    return data as RcaDiagnoseResponse;
  }, []);

  return {
    diagnosis,
    loading,
    error,
    diagnose,
    fetchDiagnosis,
  };
}

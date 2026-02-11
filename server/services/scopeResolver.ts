/**
 * Future-facing connector resolver contract.
 * CE runtime keeps all execution local; this abstraction avoids major rewrites
 * when workspace/client-level integrations are introduced.
 */

export type ConnectorKind =
  | "kubernetes"
  | "cloud"
  | "monitoring"
  | "logs"
  | "issue_tracker";

export interface ScopeResolutionInput {
  scopeId?: string;
  clusterContext?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
}

export interface ConnectorBinding {
  kind: ConnectorKind;
  id: string;
  metadata?: Record<string, string>;
}

export interface ScopeResolution {
  scopeId: string;
  clusterContext: string;
  connectors: ConnectorBinding[];
}

const DEFAULT_SCOPE_ID = "local-default";

/**
 * CE v1 resolution:
 * - always local,
 * - always brokered kubectl context,
 * - connector set limited to kubernetes.
 */
export function resolveScope(input: ScopeResolutionInput): ScopeResolution {
  const clusterContext = input.clusterContext || "prod-us-west";
  return {
    scopeId: input.scopeId || DEFAULT_SCOPE_ID,
    clusterContext,
    connectors: [
      {
        kind: "kubernetes",
        id: clusterContext,
        metadata: {
          mode: "local",
        },
      },
    ],
  };
}

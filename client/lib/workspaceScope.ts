import { useSyncExternalStore } from "react";

export type WorkspaceEnvironment = "dev" | "stage" | "prod" | "unknown";

export interface WorkspaceScope {
  scopeId: string;
  clusterContext: string;
  workingNamespace: string;
  environment: WorkspaceEnvironment;
  clientLabel?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
}

const STORAGE_KEY = "kubeagentix_scope_v1";

const DEFAULT_SCOPE: WorkspaceScope = {
  scopeId: "local-default",
  clusterContext: "prod-us-west",
  workingNamespace: "all",
  environment: "unknown",
};

function inferEnvironment(clusterContext: string): WorkspaceEnvironment {
  const normalized = clusterContext.toLowerCase();
  if (normalized.includes("prod")) return "prod";
  if (normalized.includes("stage") || normalized.includes("stg")) return "stage";
  if (normalized.includes("dev")) return "dev";
  return "unknown";
}

function normalizeScope(input: Partial<WorkspaceScope>): WorkspaceScope {
  const clusterContext = input.clusterContext?.trim() || DEFAULT_SCOPE.clusterContext;
  const workingNamespace = input.workingNamespace?.trim() || DEFAULT_SCOPE.workingNamespace;

  return {
    ...DEFAULT_SCOPE,
    ...input,
    clusterContext,
    workingNamespace,
    scopeId: input.scopeId?.trim() || DEFAULT_SCOPE.scopeId,
    environment: input.environment || inferEnvironment(clusterContext),
  };
}

function loadScopeFromStorage(): WorkspaceScope {
  if (typeof window === "undefined") {
    return DEFAULT_SCOPE;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCOPE;
    const parsed = JSON.parse(raw) as Partial<WorkspaceScope>;
    return normalizeScope(parsed);
  } catch {
    return DEFAULT_SCOPE;
  }
}

let currentScope: WorkspaceScope = loadScopeFromStorage();
const listeners = new Set<() => void>();

function persistScope(scope: WorkspaceScope) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function getWorkspaceScope(): WorkspaceScope {
  return currentScope;
}

export function setWorkspaceScope(update: Partial<WorkspaceScope>) {
  const next = normalizeScope({ ...currentScope, ...update });
  currentScope = next;
  persistScope(next);
  emit();
}

export function resetWorkspaceScope() {
  currentScope = DEFAULT_SCOPE;
  persistScope(DEFAULT_SCOPE);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceScope() {
  return useSyncExternalStore(subscribe, getWorkspaceScope, getWorkspaceScope);
}

export function getWorkspaceStorageKey() {
  return STORAGE_KEY;
}

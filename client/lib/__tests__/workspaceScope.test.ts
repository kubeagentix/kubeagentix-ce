import { beforeEach, describe, expect, it } from "vitest";
import {
  getWorkspaceScope,
  getWorkspaceStorageKey,
  resetWorkspaceScope,
  setWorkspaceScope,
} from "../workspaceScope";

function ensureLocalStorage() {
  const candidate = (globalThis as any).localStorage;
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return;
  }

  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
    },
  });
}

describe("workspaceScope", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.removeItem(getWorkspaceStorageKey());
    resetWorkspaceScope();
  });

  it("starts with defaults", () => {
    const scope = getWorkspaceScope();
    expect(scope.clusterContext).toBe("prod-us-west");
    expect(scope.workingNamespace).toBe("all");
  });

  it("persists cluster and namespace updates", () => {
    setWorkspaceScope({
      clusterContext: "dev-cluster",
      workingNamespace: "dev",
      scopeId: "scope-dev",
    });

    const scope = getWorkspaceScope();
    expect(scope.clusterContext).toBe("dev-cluster");
    expect(scope.workingNamespace).toBe("dev");
    expect(scope.scopeId).toBe("scope-dev");

    const persisted = JSON.parse(localStorage.getItem(getWorkspaceStorageKey()) || "{}");
    expect(persisted.clusterContext).toBe("dev-cluster");
    expect(persisted.workingNamespace).toBe("dev");
  });
});

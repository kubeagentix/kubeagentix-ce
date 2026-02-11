import { useEffect, useMemo, useState } from "react";
import { Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { setWorkspaceScope, useWorkspaceScope } from "@/lib/workspaceScope";

const FALLBACK_NAMESPACES = ["all", "default", "kube-system", "monitoring"];

export const Header = () => {
  const navigate = useNavigate();
  const scope = useWorkspaceScope();
  const [availableContexts, setAvailableContexts] = useState<string[]>([]);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>(
    FALLBACK_NAMESPACES,
  );

  useEffect(() => {
    let active = true;

    const loadContexts = async () => {
      try {
        const response = await fetch("/api/k8s/contexts");
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          contexts?: string[];
          currentContext?: string;
        };
        if (!active) return;

        const contexts = Array.from(new Set(payload.contexts || [])).filter(Boolean);
        if (contexts.length > 0) {
          setAvailableContexts(contexts);
        }

        if (
          payload.currentContext &&
          !contexts.includes(scope.clusterContext) &&
          payload.currentContext !== scope.clusterContext
        ) {
          setWorkspaceScope({ clusterContext: payload.currentContext });
        }
      } catch {
        // Keep current value and fallback list.
      }
    };

    void loadContexts();
    return () => {
      active = false;
    };
  }, [scope.clusterContext]);

  useEffect(() => {
    let active = true;

    const loadNamespaces = async () => {
      try {
        const response = await fetch(
          `/api/k8s/resources/namespace?namespace=all&limit=200&context=${encodeURIComponent(scope.clusterContext)}`,
        );
        if (!response.ok) return;

        const payload = (await response.json()) as {
          resources?: Array<{ name?: string }>;
        };
        if (!active) return;

        const discovered = Array.from(
          new Set(
            (payload.resources || [])
              .map((resource) => resource.name?.trim())
              .filter((value): value is string => !!value),
          ),
        ).sort((a, b) => a.localeCompare(b));

        const next = ["all", ...discovered];
        setAvailableNamespaces(next.length > 1 ? next : FALLBACK_NAMESPACES);
      } catch {
        // Keep fallback namespaces.
      }
    };

    void loadNamespaces();
    return () => {
      active = false;
    };
  }, [scope.clusterContext]);

  const contexts = useMemo(
    () =>
      availableContexts.length > 0
        ? availableContexts
        : Array.from(new Set([scope.clusterContext])),
    [availableContexts, scope.clusterContext],
  );

  const namespaces = useMemo(() => {
    const merged = Array.from(
      new Set(["all", scope.workingNamespace, ...availableNamespaces].filter(Boolean)),
    ) as string[];
    return merged;
  }, [availableNamespaces, scope.workingNamespace]);

  return (
    <header className="bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-orange-700" />
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-white">KubeAgentiX</span>
            <span className="text-sm font-semibold uppercase tracking-wide text-[#C2410C]">
              CE
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Cluster:</span>
            <select
              value={scope.clusterContext}
              onChange={(event) =>
                setWorkspaceScope({
                  clusterContext: event.target.value,
                })
              }
              className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-orange-600"
            >
              {contexts.map((contextName) => (
                <option key={contextName} value={contextName}>
                  {contextName}
                </option>
              ))}
            </select>
          </div>
          <div className="w-px h-4 bg-zinc-700" />
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Default Namespace:</span>
            <select
              value={scope.workingNamespace}
              onChange={(event) =>
                setWorkspaceScope({
                  workingNamespace: event.target.value,
                })
              }
              className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-orange-600"
            >
              {namespaces.map((namespace) => (
                <option key={namespace} value={namespace}>
                  {namespace === "all" ? "All namespaces" : namespace}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Button
        onClick={() => navigate("/settings")}
        variant="ghost"
        size="icon"
        className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        title="Settings"
      >
        <Settings className="w-5 h-5" />
      </Button>
    </header>
  );
};

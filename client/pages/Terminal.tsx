import { AppShell } from "@/components/layout/AppShell";
import { KubectlTerminal } from "@/components/terminal/KubectlTerminal";
import { useWorkspaceScope } from "@/lib/workspaceScope";

/**
 * Terminal Page
 * Dedicated page for the kubectl terminal interface
 * Provides direct command execution capabilities for Kubernetes operations
 */
export default function Terminal() {
  const scope = useWorkspaceScope();

  return (
    <AppShell mode="terminal">
      <div className="h-[calc(100vh-140px)] flex flex-col p-6 overflow-x-hidden">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-white mb-2">Terminal</h1>
          <p className="text-zinc-400">
            Execute kubectl commands directly or translate natural language into safe commands
          </p>
        </div>
        <div className="flex-1">
          <KubectlTerminal
            context={scope.clusterContext}
            namespace={scope.workingNamespace || "all"}
          />
        </div>
      </div>
    </AppShell>
  );
}

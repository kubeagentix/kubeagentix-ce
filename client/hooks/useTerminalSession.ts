import { useState, useCallback } from "react";

export interface TerminalLine {
  id: string;
  type: "input" | "output" | "error";
  content: string;
}

interface TerminalSessionScope {
  namespace?: string;
  scopeId?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
}

export function useTerminalSession(
  context: string = "prod-us-west",
  scope: TerminalSessionScope = {},
) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "1", type: "output", content: "kubectl terminal ready" },
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const executeCommand = useCallback(
    async (command: string): Promise<void> => {
      const trimmed = command.trim();
      if (!trimmed) return;

      const newId = Date.now().toString();
      setLines((prev) => [
        ...prev,
        { id: newId, type: "input", content: `$ ${trimmed}` },
      ]);
      setHistory((prev) => [...prev, trimmed]);
      setIsExecuting(true);

      try {
        const response = await fetch("/api/cli/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            command: trimmed,
            context,
            clusterContext: context,
            namespace: scope.namespace,
            scopeId: scope.scopeId,
            workspaceId: scope.workspaceId,
            tenantId: scope.tenantId,
            integrationProfileId: scope.integrationProfileId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          const code = data?.error?.code ? ` (${data.error.code})` : "";
          const message = data?.error?.message || `Command failed${code}`;

          setLines((prev) => [
            ...prev,
            { id: newId + "e", type: "error", content: `Error${code}: ${message}` },
          ]);
          return;
        }

        if (data.stdout) {
          setLines((prev) => [
            ...prev,
            { id: newId + "o", type: "output", content: data.stdout },
          ]);
        }

        if (data.stderr) {
          setLines((prev) => [
            ...prev,
            { id: newId + "se", type: "error", content: data.stderr },
          ]);
        }

        if (!data.stdout && !data.stderr) {
          setLines((prev) => [
            ...prev,
            {
              id: newId + "o",
              type: "output",
              content: `Command exited with code ${data.exitCode}`,
            },
          ]);
        }
      } catch (error) {
        setLines((prev) => [
          ...prev,
          {
            id: newId + "e",
            type: "error",
            content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ]);
      } finally {
        setIsExecuting(false);
      }
    },
    [context, scope.integrationProfileId, scope.namespace, scope.scopeId, scope.tenantId, scope.workspaceId],
  );

  const clearTerminal = useCallback(() => {
    setLines([]);
  }, []);

  return {
    lines,
    history,
    isExecuting,
    executeCommand,
    clearTerminal,
  };
}

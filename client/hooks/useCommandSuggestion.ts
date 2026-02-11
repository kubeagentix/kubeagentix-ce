import { useCallback, useState } from "react";
import { BrokerSuggestResponse } from "@shared/terminal";
import { getStoredModelPreferences } from "@/lib/modelPreferences";

interface SuggestionInput {
  query: string;
  context?: string;
  clusterContext?: string;
  scopeId?: string;
  workingNamespace?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  namespace?: string;
  recentTerminalContext?: Array<{
    type: "input" | "output" | "error";
    content: string;
  }>;
}

export function useCommandSuggestion() {
  const [suggestion, setSuggestion] = useState<BrokerSuggestResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const suggestCommand = useCallback(async (input: SuggestionInput) => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setSuggestion(null);

    try {
      const response = await fetch("/api/cli/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          modelPreferences: getStoredModelPreferences(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const code = data?.error?.code;
        setErrorCode(typeof code === "string" ? code : null);
        if (code === "SUGGESTION_UNAVAILABLE") {
          throw new Error(
            "This request is better handled in Chat. Switch to the Chat panel and ask the same question for RCA.",
          );
        }
        throw new Error(data?.error?.message || "Failed to suggest command");
      }

      setSuggestion(data as BrokerSuggestResponse);
      return data as BrokerSuggestResponse;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to suggest command";
      setError(message);
      setSuggestion(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSuggestion = useCallback(() => {
    setSuggestion(null);
    setError(null);
    setErrorCode(null);
  }, []);

  return {
    suggestion,
    loading,
    error,
    errorCode,
    suggestCommand,
    clearSuggestion,
  };
}

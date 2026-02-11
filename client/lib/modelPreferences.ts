export interface StoredModelPreferences {
  providerId?: string;
  model?: string;
  apiKey?: string;
}

/**
 * Read preferred model/provider configuration from local storage.
 * Mirrors existing CE web runtime behavior for provider selection.
 */
export function getStoredModelPreferences():
  | StoredModelPreferences
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    let llmConfigs: Record<
      string,
      { model?: string; enabled?: boolean; apiKey?: string }
    > = {};

    const rawLlmConfigs = localStorage.getItem("llm_configs");
    if (rawLlmConfigs) {
      llmConfigs = JSON.parse(rawLlmConfigs) as Record<
        string,
        { model?: string; enabled?: boolean; apiKey?: string }
      >;
    }

    const rawProviderConfig =
      localStorage.getItem("kubeagentix_provider_config") ||
      localStorage.getItem("kubeagentics_provider_config");

    if (rawProviderConfig) {
      const parsed = JSON.parse(rawProviderConfig) as {
        selectedProviderId?: string;
        selectedModel?: string;
      };
      if (parsed.selectedProviderId || parsed.selectedModel) {
        const selectedProvider = parsed.selectedProviderId;
        const selected: StoredModelPreferences = {
          providerId: selectedProvider,
          model: parsed.selectedModel,
          apiKey: selectedProvider
            ? llmConfigs[selectedProvider]?.apiKey
            : undefined,
        };
        if (!selected.apiKey) {
          delete selected.apiKey;
        }
        return selected;
      }
    }

    const preferredProvider =
      Object.entries(llmConfigs).find(([, cfg]) => !!cfg?.enabled)?.[0] ||
      Object.entries(llmConfigs).find(([, cfg]) => !!cfg?.apiKey)?.[0];

    if (!preferredProvider) {
      return undefined;
    }

    const fallback: StoredModelPreferences = {
      providerId: preferredProvider,
      model: llmConfigs[preferredProvider]?.model,
      apiKey: llmConfigs[preferredProvider]?.apiKey,
    };

    if (!fallback.apiKey) {
      delete fallback.apiKey;
    }
    return fallback;
  } catch {
    return undefined;
  }
}


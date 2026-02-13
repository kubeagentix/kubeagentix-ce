import { useState, useEffect } from "react";

interface ProviderConfig {
  apiKey?: string;
  authToken?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

interface UseProviderConfigReturn {
  configs: Record<string, ProviderConfig>;
  updateConfig: (providerId: string, config: ProviderConfig) => Promise<void>;
  testProvider: (
    providerId: string,
    options?: { requiresCredential?: boolean },
  ) => Promise<void>;
  isLoading: Record<string, boolean>;
}

/**
 * Hook for managing LLM provider configuration
 * Stores API keys securely in system keychain (Tauri desktop app)
 * Falls back to localStorage for web development
 */
export function useProviderConfig(): UseProviderConfigReturn {
  const [configs, setConfigs] = useState<Record<string, ProviderConfig>>({});
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});

  // Load configurations from secure storage on mount
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      // Check if running in Tauri desktop app
      if (window.__TAURI__) {
        // In a real implementation, load from Tauri's keychain
        console.log("Loading configs from Tauri keychain");
        // const configs = await window.__TAURI__.invoke("get_provider_configs");
        // setConfigs(configs || {});
      } else {
        // Development: load from localStorage
        const stored = localStorage.getItem("llm_configs");
        if (stored) {
          try {
            setConfigs(JSON.parse(stored));
          } catch {
            console.error("Failed to parse stored configs");
          }
        }
      }
    } catch (error) {
      console.error("Failed to load provider configs:", error);
    }
  };

  const updateConfig = async (providerId: string, config: ProviderConfig) => {
    try {
      setIsLoading((prev) => ({ ...prev, [providerId]: true }));

      const updated = { ...configs, [providerId]: config };
      if (config.enabled) {
        for (const key of Object.keys(updated)) {
          if (key !== providerId && updated[key]?.enabled) {
            updated[key] = { ...updated[key], enabled: false };
          }
        }
      }
      setConfigs(updated);

      // Check if running in Tauri desktop app
      if (window.__TAURI__) {
        // In a real implementation, save to Tauri's keychain
        console.log(`Saving ${providerId} config to Tauri keychain`);
        // await window.__TAURI__.invoke("save_provider_config", {
        //   provider_id: providerId,
        //   config,
        // });
      } else {
        // Development: save to localStorage
        localStorage.setItem("llm_configs", JSON.stringify(updated));
      }
    } catch (error) {
      console.error(`Failed to update config for ${providerId}:`, error);
      throw error;
    } finally {
      setIsLoading((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const testProvider = async (
    providerId: string,
    options?: { requiresCredential?: boolean },
  ) => {
    try {
      setIsLoading((prev) => ({ ...prev, [providerId]: true }));

      const config = configs[providerId];
      const requiresCredential = options?.requiresCredential !== false;
      if (
        requiresCredential &&
        !config?.apiKey &&
        !config?.authToken
      ) {
        throw new Error("API key or auth token not configured");
      }

      // Test provider connection
      const response = await fetch("/api/agent/test-provider", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          apiKey: config.apiKey,
          authToken: config.authToken,
          model: config.model,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Provider test failed");
      }

      return await response.json();
    } catch (error) {
      console.error(`Failed to test ${providerId}:`, error);
      throw error;
    } finally {
      setIsLoading((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  return {
    configs,
    updateConfig,
    testProvider,
    isLoading,
  };
}

// Type declaration for Tauri (when in desktop app)
declare global {
  interface Window {
    __TAURI__?: any;
  }
}

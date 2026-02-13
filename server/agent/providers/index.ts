/**
 * LLM Providers Index
 *
 * Re-exports all provider implementations and provides factory functions
 * for creating provider instances.
 */

export { ClaudeProvider, createClaudeProvider } from "./claude";
export { OpenAIProvider, createOpenAIProvider } from "./openai";
export { GeminiProvider, createGeminiProvider } from "./gemini";

import { LLMProvider, AgentError } from "@shared/coordination";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";

/**
 * Provider configuration for initialization
 */
export interface ProviderConfig {
  claudeApiKey?: string;
  claudeAuthToken?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
}

/**
 * Create all configured providers
 * Only creates providers that have API keys configured
 */
export function createConfiguredProviders(
  config: ProviderConfig = {}
): Map<string, LLMProvider> {
  const providers = new Map<string, LLMProvider>();

  // Try to create Claude provider
  const claudeApiKey = config.claudeApiKey || process.env.ANTHROPIC_API_KEY;
  const claudeAuthToken =
    config.claudeAuthToken || process.env.ANTHROPIC_AUTH_TOKEN;
  if (claudeApiKey || claudeAuthToken) {
    try {
      providers.set("claude", new ClaudeProvider(claudeApiKey, claudeAuthToken));
    } catch (error) {
      console.warn("Failed to initialize Claude provider:", error);
    }
  }

  // Try to create OpenAI provider
  const openaiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      providers.set("openai", new OpenAIProvider(openaiKey));
    } catch (error) {
      console.warn("Failed to initialize OpenAI provider:", error);
    }
  }

  // Try to create Gemini provider
  const geminiKey = config.geminiApiKey || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      providers.set("gemini", new GeminiProvider(geminiKey));
    } catch (error) {
      console.warn("Failed to initialize Gemini provider:", error);
    }
  }

  return providers;
}

/**
 * Create a specific provider by ID
 */
export function createProvider(
  providerId: string,
  apiKey?: string,
  authToken?: string,
): LLMProvider {
  switch (providerId) {
    case "claude":
      return new ClaudeProvider(apiKey, authToken);
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider(apiKey);
    default:
      throw new AgentError(
        "UNKNOWN_PROVIDER",
        `Unknown provider: ${providerId}`,
        false
      );
  }
}

/**
 * Get list of all available provider IDs
 */
export function getAvailableProviderIds(): string[] {
  return ["claude", "openai", "gemini"];
}

/**
 * Get provider metadata without instantiation
 */
export function getProviderMetadata(): Array<{
  id: string;
  name: string;
  contextWindowSize: number;
  supportsToolUse: boolean;
  supportsStreaming: boolean;
  supportsExtendedThinking: boolean;
  defaultModel: string;
}> {
  return [
    {
      id: "claude",
      name: "Claude (Anthropic)",
      contextWindowSize: 200000,
      supportsToolUse: true,
      supportsStreaming: true,
      supportsExtendedThinking: true,
      defaultModel: "claude-sonnet-4-5-20250929",
    },
    {
      id: "openai",
      name: "OpenAI",
      contextWindowSize: 128000,
      supportsToolUse: true,
      supportsStreaming: true,
      supportsExtendedThinking: false,
      defaultModel: "gpt-5.2",
    },
    {
      id: "gemini",
      name: "Gemini (Google)",
      contextWindowSize: 1000000,
      supportsToolUse: true,
      supportsStreaming: true,
      supportsExtendedThinking: false,
      defaultModel: "gemini-2.5-flash",
    },
  ];
}

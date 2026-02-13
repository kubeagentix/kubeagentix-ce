import { useState } from "react";
import { Brain, Zap, Sparkles } from "lucide-react";
import { ProviderCard } from "./ProviderCard";
import { useProviderConfig } from "@/hooks/useProviderConfig";

export const providers = [
  {
    id: "claude_code",
    name: "Claude Code (Subscription)",
    description:
      "Uses Claude Code local login or auth token (no Anthropic API key required)",
    models: [
      { id: "sonnet", name: "Sonnet (Alias)" },
      { id: "opus", name: "Opus (Alias)" },
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
    pricing: "Uses your Claude Code subscription/account",
    features: ["Subscription Auth", "Streaming", "No API Key", "Headless Token"],
    icon: "brain",
    requiresCredential: false,
    supportsOptionalCredential: true,
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    description: "Most capable model with extended thinking and vision",
    models: [
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (Default)" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Latest)" },
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
      { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-7-sonnet-20250219", name: "Claude Sonnet 3.7 (Legacy)" },
      { id: "claude-3-5-haiku-latest", name: "Claude Haiku 3.5 (Legacy)" },
    ],
    pricing: "$0.003 / 1K input, $0.015 / 1K output tokens",
    features: ["Streaming", "Extended Thinking", "Vision", "Tool Use"],
    icon: "brain",
    requiresCredential: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-5 family with reliable performance",
    models: [
      { id: "gpt-5.2", name: "GPT-5.2 (Latest)" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    ],
    pricing: "$0.01 / 1K input, $0.03 / 1K output tokens",
    features: ["Streaming", "Vision", "Function Calling"],
    icon: "zap",
    requiresCredential: true,
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    description: "Cost-effective with 1M token context window",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Latest)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    ],
    pricing: "$0.00025 / 1K input, $0.0005 / 1K output tokens",
    features: ["Streaming", "1M Context", "Vision", "Tool Use"],
    icon: "sparkles",
    requiresCredential: true,
  },
];

const iconMap: Record<string, React.ReactNode> = {
  brain: <Brain className="w-6 h-6" />,
  zap: <Zap className="w-6 h-6" />,
  sparkles: <Sparkles className="w-6 h-6" />,
};

export function LLMProviderSettings() {
  const { configs, updateConfig, testProvider, isLoading } =
    useProviderConfig();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h2 className="text-xl font-semibold text-white mb-2">
          AI Model Providers
        </h2>
        <p className="text-zinc-400 mb-4">
          Configure your preferred LLM providers. API keys are securely stored
          in your system keychain.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-orange-400 font-semibold">Secure Storage</div>
            <p className="text-zinc-500">
              Keys stored in macOS/Windows/Linux keychain
            </p>
          </div>
          <div>
            <div className="text-orange-400 font-semibold">Auto-selection</div>
            <p className="text-zinc-500">
              System picks best provider based on task
            </p>
          </div>
          <div>
            <div className="text-orange-400 font-semibold">Fallback</div>
            <p className="text-zinc-500">
              Automatically tries next provider if one fails
            </p>
          </div>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="space-y-4">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            config={configs[provider.id]}
            onConfigChange={(config) => updateConfig(provider.id, config)}
            onTest={() =>
              testProvider(provider.id, {
                requiresCredential: provider.requiresCredential !== false,
              })
            }
            isLoading={isLoading[provider.id]}
            isExpanded={expandedProvider === provider.id}
            onExpandChange={(expanded) =>
              setExpandedProvider(expanded ? provider.id : null)
            }
          />
        ))}
      </div>

      {/* Help Section */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Getting API Keys
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="font-semibold text-white mb-2">Claude API</div>
            <p className="text-zinc-400 text-sm mb-3">
              Visit Anthropic's console to get your API key.
            </p>
            <a
              href="https://console.anthropic.com/account/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 text-sm font-medium"
            >
              Get Claude API Key →
            </a>
          </div>
          <div>
            <div className="font-semibold text-white mb-2">OpenAI API</div>
            <p className="text-zinc-400 text-sm mb-3">
              Get your API key from OpenAI's platform dashboard.
            </p>
            <a
              href="https://platform.openai.com/account/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 text-sm font-medium"
            >
              Get OpenAI API Key →
            </a>
          </div>
          <div>
            <div className="font-semibold text-white mb-2">Gemini API</div>
            <p className="text-zinc-400 text-sm mb-3">
              Get a free API key from Google AI Studio.
            </p>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 text-sm font-medium"
            >
              Get Gemini API Key →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import {
  ChevronDown,
  Lock,
  Zap,
  Trash2,
  Check,
  X,
  Brain,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderConfig {
  apiKey?: string;
  authToken?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

interface ProviderCardProps {
  provider: {
    id: string;
    name: string;
    description: string;
    models: Array<{ id: string; name: string }>;
    pricing: string;
    features: string[];
    icon: string;
    requiresCredential?: boolean;
    supportsOptionalCredential?: boolean;
  };
  config?: ProviderConfig;
  onConfigChange: (config: ProviderConfig) => void;
  onTest: () => Promise<void>;
  isLoading: boolean;
  isExpanded: boolean;
  onExpandChange: (expanded: boolean) => void;
}

export function ProviderCard({
  provider,
  config = {},
  onConfigChange,
  onTest,
  isLoading,
  isExpanded,
  onExpandChange,
}: ProviderCardProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = useState("");

  const requiresCredential = provider.requiresCredential !== false;
  const supportsOptionalCredential = provider.supportsOptionalCredential === true;
  const showCredentialInput = requiresCredential || supportsOptionalCredential;
  const handleTest = async () => {
    try {
      setTestStatus("idle");
      await onTest();
      setTestStatus("success");
      setTestMessage("Connection successful!");
      setTimeout(() => setTestStatus("idle"), 3000);
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection failed",
      );
      setTimeout(() => setTestStatus("idle"), 5000);
    }
  };

  const hasCredential =
    !requiresCredential || !!config.apiKey || !!config.authToken;
  const credentialLabel =
    provider.id === "claude_code"
      ? "Auth Token (Optional)"
      : provider.id === "claude"
        ? "API Key or Auth Token"
        : "API Key";
  const credentialPlaceholder =
    provider.id === "claude_code"
      ? "Paste Claude auth token for Docker/headless use..."
      : provider.id === "claude"
        ? "Paste your Anthropic API key or auth token..."
        : "Paste your API key here...";

  const iconMap: Record<string, React.ReactNode> = {
    brain: <Brain className="w-8 h-8 text-orange-400" />,
    zap: <Zap className="w-8 h-8 text-orange-400" />,
    sparkles: <Sparkles className="w-8 h-8 text-orange-400" />,
  };

  return (
    <div className="bg-blue-900/20 rounded-lg border border-blue-800 overflow-hidden hover:border-blue-700 transition-colors">
      {/* Header */}
      <button
        onClick={() => onExpandChange(!isExpanded)}
        className="w-full p-6 flex items-center justify-between hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-4 flex-1">
          <div>
            {iconMap[provider.icon] || (
              <Brain className="w-8 h-8 text-orange-400" />
            )}
          </div>
          <div className="text-left flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-white">{provider.name}</h3>
              {config.enabled && (
                <div className="flex items-center gap-1 text-green-400 text-xs">
                  <Check className="w-3 h-3" />
                  <span>Preferred</span>
                </div>
              )}
              {!config.enabled && hasCredential && (
                <div className="flex items-center gap-1 text-green-400 text-xs">
                  <Check className="w-3 h-3" />
                  <span>Ready</span>
                </div>
              )}
            </div>
            <p className="text-sm text-zinc-400">{provider.description}</p>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-zinc-400 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-zinc-800 p-6 space-y-6">
          {/* Features and Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-zinc-400 block mb-2">
                Features
              </label>
              <div className="flex flex-wrap gap-2">
                {provider.features.map((feature) => (
                  <span
                    key={feature}
                    className="px-2 py-1 bg-orange-950/40 text-orange-300 text-xs rounded"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-400 block mb-2">
                Pricing
              </label>
              <p className="text-sm text-zinc-300">{provider.pricing}</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 p-3">
            <div>
              <div className="text-sm font-semibold text-zinc-200">
                Use For Tasks
              </div>
              <div className="text-xs text-zinc-500">
                Marks this provider as your default for diagnosis and suggestions.
              </div>
            </div>
            <Button
              onClick={() =>
                onConfigChange({
                  ...config,
                  enabled: true,
                  model: config.model || provider.models[0]?.id,
                })
              }
              variant={config.enabled ? "secondary" : "default"}
              className={
                config.enabled
                  ? "bg-green-900 text-green-200 hover:bg-green-900"
                  : "bg-sky-400/60 hover:bg-sky-400/70 text-white"
              }
            >
              {config.enabled ? "Preferred" : "Set Preferred"}
            </Button>
          </div>

          {/* API Key */}
          {showCredentialInput && (
          <div>
            <label className="text-sm font-semibold text-zinc-300 flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4" />
              {credentialLabel}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder={credentialPlaceholder}
                  value={config.apiKey || config.authToken || ""}
                  onChange={(e) =>
                    provider.id === "claude_code"
                      ? onConfigChange({
                          ...config,
                          authToken: e.target.value,
                          apiKey: undefined,
                        })
                      : onConfigChange({
                          ...config,
                          apiKey: e.target.value,
                          authToken: undefined,
                        })
                  }
                  className="bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500"
                />
                {(config.apiKey || config.authToken) && (
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-sm"
                  >
                    {showApiKey ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              {(config.apiKey || config.authToken) && (
                <Button
                  onClick={() =>
                    onConfigChange({ ...config, apiKey: "", authToken: "" })
                  }
                  variant="outline"
                  size="sm"
                  className="border-red-900 text-red-400 hover:bg-red-950"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              🔒 Your credential is stored securely in your system keychain.
            </p>
            {provider.id === "claude_code" && (
              <p className="text-xs text-zinc-500 mt-1">
                Optional fallback when Claude local login is unavailable.
              </p>
            )}
          </div>
          )}

          {/* Model Selection */}
          {hasCredential && (
            <>
              <div>
                <label className="text-sm font-semibold text-zinc-300 block mb-2">
                  Model
                </label>
                <Select
                  value={config.model || provider.models[0].id}
                  onValueChange={(model) =>
                    onConfigChange({ ...config, model })
                  }
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {provider.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-zinc-300 block mb-2">
                    Temperature ({config.temperature || 0.7})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={config.temperature || 0.7}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        temperature: parseFloat(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Higher = more creative, Lower = more deterministic
                  </p>
                </div>
                <div>
                  <label className="text-sm font-semibold text-zinc-300 block mb-2">
                    Max Tokens
                  </label>
                  <Input
                    type="number"
                    placeholder="2048"
                    value={config.maxTokens || ""}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        maxTokens: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
              </div>

              {/* Test Button */}
              <Button
                onClick={handleTest}
                disabled={isLoading || (requiresCredential && !hasCredential)}
                className="w-full bg-sky-400/60 hover:bg-sky-400/70 text-white"
              >
                <Zap className="w-4 h-4 mr-2" />
                {isLoading ? "Testing..." : "Test Connection"}
              </Button>

              {/* Test Status */}
              {testStatus !== "idle" && (
                <div
                  className={`p-3 rounded-lg flex items-center gap-2 ${
                    testStatus === "success"
                      ? "bg-green-950 text-green-400"
                      : "bg-red-950 text-red-400"
                  }`}
                >
                  {testStatus === "success" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  <span className="text-sm">{testMessage}</span>
                </div>
              )}
            </>
          )}

          {/* Info when no credential */}
          {requiresCredential && !hasCredential && (
            <div className="p-4 bg-zinc-800 rounded-lg border border-zinc-700">
              <p className="text-sm text-zinc-300">
                ✨ Add a credential to configure this provider and make it
                available for your tasks.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

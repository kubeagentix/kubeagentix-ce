import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { LLMProviderSettings } from "@/components/settings/LLMProviderSettings";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export default function Settings() {
  const [activeTab, setActiveTab] = useState<"providers" | "general">(
    "providers",
  );

  return (
    <AppShell mode="settings">
      <div className="flex-1 overflow-auto bg-zinc-950">
        <div className="max-w-6xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
            <p className="text-zinc-400">
              Configure your KubeAgentiX preferences and LLM providers
            </p>
          </div>

          {/* Settings Navigation */}
          <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Settings Content */}
          <div className="mt-6">
            {activeTab === "providers" && <LLMProviderSettings />}
            {activeTab === "general" && (
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                <p className="text-zinc-400">General settings coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

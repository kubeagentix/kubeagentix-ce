import { Cog, Zap } from "lucide-react";

interface SettingsTabsProps {
  activeTab: "providers" | "general";
  onTabChange: (tab: "providers" | "general") => void;
}

const tabs: Array<{
  id: "providers" | "general";
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    id: "providers",
    label: "LLM Providers",
    icon: <Zap className="w-4 h-4" />,
    description: "Configure AI model providers",
  },
  {
    id: "general",
    label: "General",
    icon: <Cog className="w-4 h-4" />,
    description: "App preferences and behavior",
  },
];

export function SettingsTabs({ activeTab, onTabChange }: SettingsTabsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`p-4 rounded-lg border-2 transition-all text-left ${
            activeTab === tab.id
              ? "border-orange-700 bg-orange-700/20"
              : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className={
                activeTab === tab.id ? "text-orange-400" : "text-zinc-400"
              }
            >
              {tab.icon}
            </div>
            <h3
              className={`font-semibold ${activeTab === tab.id ? "text-orange-400" : "text-zinc-100"}`}
            >
              {tab.label}
            </h3>
          </div>
          <p className="text-sm text-zinc-500">{tab.description}</p>
        </button>
      ))}
    </div>
  );
}

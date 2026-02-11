import { useState } from "react";
import { Moon, Sun, Globe } from "lucide-react";

export function GeneralSettings() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [language, setLanguage] = useState("en");
  const [logLevel, setLogLevel] = useState("info");

  return (
    <div className="space-y-6">
      {/* Theme Selection */}
      <div>
        <label className="text-sm font-semibold text-white block mb-2">
          Theme
        </label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "dark" as const, label: "Dark", icon: Moon },
            { value: "light" as const, label: "Light", icon: Sun },
            { value: "system" as const, label: "System", icon: Globe },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`p-3 rounded-lg border-2 flex items-center gap-2 transition ${
                theme === value
                  ? "border-orange-700 bg-orange-700/20 text-white"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="text-sm font-semibold text-white block mb-2">
          Language
        </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white"
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {/* Log Level */}
      <div>
        <label className="text-sm font-semibold text-white block mb-2">
          Log Level
        </label>
        <select
          value={logLevel}
          onChange={(e) => setLogLevel(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white"
        >
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Save button */}
      <button className="px-4 py-2 bg-orange-700 hover:bg-orange-800 text-white rounded font-semibold transition">
        Save Settings
      </button>
    </div>
  );
}

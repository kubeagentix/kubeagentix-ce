import {
  MessageSquare,
  Zap,
  AlertCircle,
  BookOpen,
  LayoutDashboard,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export type Mode =
  | "dashboard"
  | "chat"
  | "quickdx"
  | "incident"
  | "runbooks"
  | "terminal"
  | "settings";

interface ModeSelectorProps {
  currentMode: Mode;
}

const modes: Array<{
  id: Mode;
  label: string;
  icon: React.ReactNode;
  path: string;
}> = [
  {
    id: "chat",
    label: "Chat",
    icon: <MessageSquare className="w-4 h-4" />,
    path: "/chat",
  },
  {
    id: "quickdx",
    label: "Quick Dx",
    icon: <Zap className="w-4 h-4" />,
    path: "/quick-dx",
  },
  {
    id: "incident",
    label: "Incident",
    icon: <AlertCircle className="w-4 h-4" />,
    path: "/incident",
  },
  {
    id: "runbooks",
    label: "Runbooks",
    icon: <BookOpen className="w-4 h-4" />,
    path: "/runbooks",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: <TerminalIcon className="w-4 h-4" />,
    path: "/terminal",
  },
];

export const ModeSelector = ({ currentMode }: ModeSelectorProps) => {
  const navigate = useNavigate();

  return (
    <div className="bg-zinc-950 border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-1 p-1 bg-zinc-900 rounded-lg">
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => navigate(mode.path)}
            className={`mode-button ${
              currentMode === mode.id
                ? "mode-button-active bg-orange-700"
                : "mode-button-inactive text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {mode.icon}
            <span>{mode.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="w-px h-6 bg-zinc-700" />
        <button
          onClick={() => navigate("/")}
          className={`mode-button ${
            currentMode === "dashboard"
              ? "mode-button-active bg-orange-700"
              : "mode-button-inactive text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Dashboard</span>
        </button>
      </div>
    </div>
  );
};

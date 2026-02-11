import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ChevronDown,
  BarChart3,
  MessageCircle,
  AlertCircle,
  BookOpen,
  Zap,
  Settings,
  Menu,
  X,
  Terminal as TerminalIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  group: string;
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    path: "/",
    icon: <BarChart3 className="w-5 h-5" />,
    group: "Main",
  },
  {
    label: "Chat",
    path: "/chat",
    icon: <MessageCircle className="w-5 h-5" />,
    group: "Main",
  },
  {
    label: "Quick Dx",
    path: "/quickdx",
    icon: <Zap className="w-5 h-5" />,
    group: "Tools",
  },
  {
    label: "Incidents",
    path: "/incident",
    icon: <AlertCircle className="w-5 h-5" />,
    group: "Tools",
  },
  {
    label: "Runbooks",
    path: "/runbooks",
    icon: <BookOpen className="w-5 h-5" />,
    group: "Tools",
  },
  {
    label: "Terminal",
    path: "/terminal",
    icon: <TerminalIcon className="w-5 h-5" />,
    group: "Tools",
  },
  {
    label: "Settings",
    path: "/settings",
    icon: <Settings className="w-5 h-5" />,
    group: "Config",
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["Main", "Tools"]),
  );

  const toggleGroup = (group: string) => {
    const newGroups = new Set(expandedGroups);
    if (newGroups.has(group)) {
      newGroups.delete(group);
    } else {
      newGroups.add(group);
    }
    setExpandedGroups(newGroups);
  };

  const groups = Array.from(new Set(navItems.map((item) => item.group)));

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-20 left-4 z-50 lg:hidden bg-zinc-800 p-2 rounded"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-16 h-screen bg-zinc-900 border-r border-zinc-800 transition-all duration-300 z-40 ${
          isOpen ? "w-64" : "w-0 hidden lg:w-64"
        }`}
      >
        <div className="p-4 space-y-4 h-full overflow-y-auto">
          {groups.map((group) => (
            <div key={group}>
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition"
              >
                {group}
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    expandedGroups.has(group) ? "rotate-180" : ""
                  }`}
                />
              </button>

              {expandedGroups.has(group) && (
                <div className="space-y-1">
                  {navItems
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition ${
                          location.pathname === item.path
                            ? "bg-orange-700/20 text-orange-400 border border-orange-700/50"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                        }`}
                      >
                        {item.icon}
                        <span className="text-sm">{item.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
        />
      )}
    </>
  );
}

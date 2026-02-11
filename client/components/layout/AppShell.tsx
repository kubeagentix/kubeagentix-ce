import { ReactNode } from "react";
import { Header } from "./Header";
import { ModeSelector, type Mode } from "./ModeSelector";

interface AppShellProps {
  children: ReactNode;
  mode: Mode;
}

export const AppShell = ({ children, mode }: AppShellProps) => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <ModeSelector currentMode={mode} />
      <main className="flex-1">{children}</main>
    </div>
  );
};

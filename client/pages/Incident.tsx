import { AppShell } from "@/components/layout/AppShell";
import { Construction } from "lucide-react";

export default function Incident() {
  return (
    <AppShell mode="incident">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Incident Response</h1>
        <p className="text-zinc-400 mb-6">Evidence-backed incident context from guided RCA.</p>

        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-6">
          <div className="flex items-start gap-3">
            <Construction className="mt-0.5 h-5 w-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-amber-200">
                Coming Soon
              </h2>
              <p className="mt-2 text-sm text-amber-100/90">
                The Incident workflow is not active yet. This feature is coming soon.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

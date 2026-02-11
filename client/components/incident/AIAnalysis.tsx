import { Brain } from "lucide-react";

interface AIAnalysisProps {
  rootCause: string;
  impacts: string[];
  recommendations: string[];
}

export function AIAnalysis({
  rootCause,
  impacts,
  recommendations,
}: AIAnalysisProps) {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
          <Brain className="w-4 h-4 text-orange-400" />
          Root Cause Analysis
        </h4>
        <div className="bg-zinc-800/50 border border-zinc-700 rounded p-4 text-white">
          {rootCause}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">
          Impact Analysis
        </h4>
        <ul className="space-y-2">
          {impacts.map((impact, idx) => (
            <li key={idx} className="flex items-start gap-2 text-zinc-300">
              <span className="text-orange-400 mt-1">•</span>
              <span>{impact}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white mb-2">
          Recommendations
        </h4>
        <ul className="space-y-2">
          {recommendations.map((rec, idx) => (
            <li key={idx} className="flex items-start gap-2 text-zinc-300">
              <span className="text-sky-400 mt-1">→</span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

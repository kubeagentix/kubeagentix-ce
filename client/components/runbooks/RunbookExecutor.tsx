import { useState } from "react";
import { ChevronDown, Play, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Step {
  id: string;
  title: string;
  status: "complete" | "pending" | "current" | "failed";
  output?: string;
  error?: string;
}

interface RunbookExecutorProps {
  runbookId: string;
  runbookName: string;
  steps: Step[];
  isRunning: boolean;
  progress: number;
  output: string[];
  onStart: () => void;
  onStop: () => void;
  onStepExecute?: (stepIndex: number) => void;
}

export function RunbookExecutor({
  runbookName,
  steps,
  isRunning,
  progress,
  output,
  onStart,
  onStop,
  onStepExecute,
}: RunbookExecutorProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div className="bg-blue-900/20 border border-blue-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-blue-800 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{runbookName}</h3>
        <div className="flex gap-2">
          <Button
            onClick={onStart}
            disabled={isRunning}
            className="bg-green-700 hover:bg-green-800"
          >
            <Play className="w-4 h-4 mr-2" />
            Execute
          </Button>
          <Button
            onClick={onStop}
            disabled={!isRunning}
            className="bg-red-700 hover:bg-red-800"
          >
            <StopCircle className="w-4 h-4 mr-2" />
            Stop
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Progress bar */}
        {isRunning && (
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-semibold text-zinc-300">
                Progress
              </span>
              <span className="text-sm text-zinc-400">{progress}%</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2">
              <div
                className="bg-orange-700 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-2">
          {steps.map((step, idx) => (
            <button
              key={step.id}
              onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
              className="w-full text-left p-3 bg-zinc-800/50 hover:bg-zinc-800 rounded border border-zinc-700 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {step.status === "complete" && (
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-xs text-white">
                      ✓
                    </div>
                  )}
                  {step.status === "current" && (
                    <div className="w-5 h-5 rounded-full bg-orange-400 animate-pulse" />
                  )}
                  {step.status === "pending" && (
                    <div className="w-5 h-5 rounded-full border-2 border-zinc-600" />
                  )}
                  {step.status === "failed" && (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-xs text-white">
                      !
                    </div>
                  )}
                  <span className="font-semibold text-white">{step.title}</span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    expandedStep === idx ? "rotate-180" : ""
                  }`}
                />
              </div>

              {expandedStep === idx && (step.output || step.error) && (
                <div className="mt-3 text-sm font-mono text-zinc-300">
                  {step.output && (
                    <div className="bg-zinc-900 p-2 rounded text-xs">
                      {step.output}
                    </div>
                  )}
                  {step.error && (
                    <div className="bg-red-900/30 p-2 rounded text-xs text-red-300">
                      Error: {step.error}
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Output */}
        {output.length > 0 && (
          <div className="bg-zinc-950 rounded border border-zinc-800 p-4">
            <h4 className="text-sm font-semibold text-zinc-300 mb-2">Output</h4>
            <div className="font-mono text-xs text-zinc-300 space-y-1 max-h-48 overflow-y-auto">
              {output.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

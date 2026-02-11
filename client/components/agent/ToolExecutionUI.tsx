import { useState } from "react";
import {
  ChevronDown,
  Zap,
  CheckCircle,
  AlertCircle,
  Clock,
} from "lucide-react";

interface ToolParam {
  name: string;
  value: string | number | boolean;
}

interface ToolResult {
  [key: string]: unknown;
}

interface ToolExecutionUIProps {
  toolName: string;
  status: "pending" | "executing" | "complete" | "error";
  parameters?: Record<string, unknown>;
  result?: ToolResult;
  error?: string;
  executionTime?: number;
}

/**
 * Tool execution UI component
 * Displays tool calls, execution status, and results
 */
export function ToolExecutionUI({
  toolName,
  status,
  parameters,
  result,
  error,
  executionTime,
}: ToolExecutionUIProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showRawJson, setShowRawJson] = useState(false);

  const statusIcon = {
    pending: <Clock className="w-4 h-4 text-yellow-500 animate-spin" />,
    executing: (
      <div className="w-4 h-4 bg-orange-400 rounded-full animate-pulse" />
    ),
    complete: <CheckCircle className="w-4 h-4 text-green-500" />,
    error: <AlertCircle className="w-4 h-4 text-red-500" />,
  };

  const statusText = {
    pending: "Pending",
    executing: "Executing",
    complete: "Complete",
    error: "Error",
  };

  const statusColor = {
    pending: "bg-yellow-500/10 border-yellow-500/30",
    executing: "bg-orange-500/10 border-orange-500/30",
    complete: "bg-green-500/10 border-green-500/30",
    error: "bg-red-500/10 border-red-500/30",
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden ${statusColor[status]} border-l-4 ${
        status === "error"
          ? "border-l-red-500"
          : status === "complete"
            ? "border-l-green-500"
            : status === "executing"
              ? "border-l-orange-400"
              : "border-l-yellow-500"
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition"
      >
        <div className="flex items-center gap-3">
          {statusIcon[status]}
          <div className="text-left">
            <div className="font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-400" />
              {toolName}
            </div>
            <div className="text-xs text-zinc-400">
              {statusText[status]}
              {executionTime && ` • ${executionTime}ms`}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-current/20 bg-white/2 p-4 space-y-4">
          {/* Parameters */}
          {parameters && Object.keys(parameters).length > 0 && (
            <div>
              <div className="text-sm font-semibold text-zinc-300 mb-2">
                Parameters
              </div>
              <div className="bg-zinc-950 rounded p-3 space-y-1">
                {Object.entries(parameters).map(([key, value]) => (
                  <div key={key} className="text-sm text-zinc-300 font-mono">
                    <span className="text-sky-400">{key}</span>
                    <span className="text-zinc-500">: </span>
                    <span className="text-orange-400">
                      {typeof value === "string" ? `"${value}"` : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result or Error */}
          {status === "complete" && result && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-zinc-300">
                  Result
                </div>
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                >
                  {showRawJson ? "Format" : "JSON"}
                </button>
              </div>
              <div className="bg-zinc-950 rounded p-3 max-h-64 overflow-y-auto">
                {showRawJson ? (
                  <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                ) : (
                  <JsonViewer data={result} />
                )}
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="bg-red-950/30 border border-red-900 rounded p-3">
              <div className="text-sm font-semibold text-red-400 mb-1">
                Error
              </div>
              <div className="text-sm text-red-300 font-mono">{error}</div>
            </div>
          )}

          {status === "executing" && (
            <div className="text-sm text-zinc-400">Executing {toolName}...</div>
          )}

          {status === "pending" && (
            <div className="text-sm text-zinc-400">
              Waiting to execute {toolName}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Simple JSON viewer component
 */
function JsonViewer({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    return (
      <div className="space-y-1">
        {data.map((item, index) => (
          <div key={index} className="text-xs text-zinc-300 font-mono">
            <span className="text-sky-400">[{index}]</span>
            <span className="text-zinc-500">: </span>
            {typeof item === "string" ? (
              <span className="text-orange-400">"{item}"</span>
            ) : (
              <span className="text-orange-400">{String(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === "object" && data !== null) {
    return (
      <div className="space-y-1">
        {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
          <div key={key} className="text-xs text-zinc-300 font-mono">
            <span className="text-sky-400">{key}</span>
            <span className="text-zinc-500">: </span>
            {typeof value === "string" ? (
              <span className="text-orange-400">"{value}"</span>
            ) : typeof value === "object" ? (
              <span className="text-zinc-500">[object]</span>
            ) : (
              <span className="text-orange-400">{String(value)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return <div className="text-xs text-orange-400">{String(data)}</div>;
}

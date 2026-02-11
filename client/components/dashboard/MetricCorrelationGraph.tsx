import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface CorrelationData {
  metrics: string[];
  correlations: number[][];
}

interface MetricCorrelationGraphProps {
  data?: CorrelationData;
  onMetricClick?: (metric: string) => void;
}

/**
 * Metric Correlation Graph Component
 * Signature feature showing metric correlations as a heatmap
 * Helps identify cause-effect relationships between metrics
 */
export function MetricCorrelationGraph({
  data,
  onMetricClick,
}: MetricCorrelationGraphProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);
  const matrixData = data;

  // Get color based on correlation strength
  const getCorrelationColor = (value: number): string => {
    if (value < 0) {
      return "bg-red-900/50"; // Negative correlation
    }
    if (value < 0.3) {
      return "bg-zinc-700/50"; // Low correlation
    }
    if (value < 0.6) {
      return "bg-yellow-700/50"; // Medium correlation
    }
    if (value < 0.9) {
      return "bg-orange-700/50"; // High correlation
    }
    return "bg-green-700/50"; // Very high correlation
  };

  const cellSize = 60;
  const labelWidth = 150;

  return (
    <div className="bg-blue-900/20 border border-blue-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition"
      >
        <div>
          <h3 className="text-lg font-semibold text-white">
            Metric Correlation Graph
          </h3>
          <p className="text-sm text-zinc-400 mt-1">
            Shows cause-effect relationships between metrics
          </p>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-zinc-400 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {isExpanded && (
        <div className="border-t border-blue-800 p-6">
          {!matrixData || matrixData.metrics.length === 0 ? (
            <div className="text-sm text-zinc-500">
              Not enough live metric history yet to compute correlations.
            </div>
          ) : (
            <>
          {/* Heatmap */}
          <div className="overflow-x-auto">
            <div className="inline-block">
              {/* Column headers */}
              <div className="flex">
                <div style={{ width: labelWidth }} />
                {matrixData.metrics.map((metric, col) => (
                  <div
                    key={`col-${col}`}
                    style={{ width: cellSize }}
                    className="flex items-center justify-center text-xs font-semibold text-zinc-300 text-center"
                  >
                    <div className="rotate-45 origin-center whitespace-nowrap px-1 pb-2">
                      {metric.substring(0, 5)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Heatmap rows */}
              {matrixData.metrics.map((rowMetric, row) => (
                <div key={`row-${row}`} className="flex items-center">
                  {/* Row label */}
                  <div
                    style={{ width: labelWidth }}
                    className="text-xs text-zinc-300 font-semibold truncate pr-2"
                  >
                    {rowMetric}
                  </div>

                  {/* Cells */}
                  {matrixData.correlations[row].map((value, col) => (
                    <div
                      key={`cell-${row}-${col}`}
                      style={{ width: cellSize, height: cellSize }}
                      className={`flex items-center justify-center border border-zinc-800 cursor-pointer transition ${getCorrelationColor(value)} ${
                        hoveredCell?.[0] === row || hoveredCell?.[1] === col
                          ? "ring-2 ring-orange-400"
                          : ""
                      }`}
                      onMouseEnter={() => setHoveredCell([row, col])}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={() => onMetricClick?.(rowMetric)}
                      title={`${rowMetric} ↔ ${matrixData.metrics[col]}: ${(
                        value * 100
                      ).toFixed(0)}%`}
                    >
                      <span className="text-xs font-semibold text-white">
                        {(value * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend and info */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Legend */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-300">Legend</h4>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <div className="w-4 h-4 bg-red-900/50 border border-zinc-700" />
                  Negative Correlation
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <div className="w-4 h-4 bg-zinc-700/50 border border-zinc-700" />
                  Low (0-30%)
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <div className="w-4 h-4 bg-yellow-700/50 border border-zinc-700" />
                  Medium (30-60%)
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <div className="w-4 h-4 bg-orange-700/50 border border-zinc-700" />
                  High (60-90%)
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <div className="w-4 h-4 bg-green-700/50 border border-zinc-700" />
                  Very High (90%+)
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-300">Insights</h4>
              <div className="text-xs text-zinc-400 space-y-1">
                <p>
                  • Correlations are derived from live cluster metric history.
                </p>
                <p>• Strong values suggest likely cause/effect relationships.</p>
                <p>• Click any cell to investigate that metric pair in detail.</p>
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

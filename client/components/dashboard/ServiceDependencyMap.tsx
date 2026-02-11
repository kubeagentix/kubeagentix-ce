import { useEffect, useRef, useState } from "react";
import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";

interface Service {
  id: string;
  name: string;
  status: "healthy" | "warning" | "critical";
  replicas: number;
  traffic: number;
}

interface Dependency {
  source: string;
  target: string;
  latency: number;
}

interface ServiceDependencyMapProps {
  services?: Service[];
  dependencies?: Dependency[];
  onSelectService?: (serviceId: string) => void;
}

/**
 * Service Dependency Map Component
 * D3-based visualization of service-to-service communications
 * This is a placeholder for a more complex D3 implementation
 */
export function ServiceDependencyMap({
  services = [],
  dependencies = [],
  onSelectService,
}: ServiceDependencyMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [isExpanded, setIsExpanded] = useState(true);

  const hasData = services.length > 0;

  const statusColor = {
    healthy: "text-green-500",
    warning: "text-yellow-500",
    critical: "text-red-500",
  };

  const statusBg = {
    healthy: "bg-green-500/10",
    warning: "bg-yellow-500/10",
    critical: "bg-red-500/10",
  };

  return (
    <div className="bg-blue-900/20 border border-blue-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition"
      >
        <h3 className="text-lg font-semibold text-white">
          Service Dependency Map
        </h3>
        <ChevronDown
          className={`w-5 h-5 text-zinc-400 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {isExpanded && (
        <div className="border-t border-blue-800 p-6 space-y-4">
          {/* Canvas area - placeholder for D3 visualization */}
          <div
            ref={canvasRef}
            className="w-full h-96 bg-zinc-950 rounded-lg border border-zinc-800 relative overflow-hidden"
          >
            {/* Zoom controls */}
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 text-zinc-300"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 text-zinc-300"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>

            {/* Placeholder visualization - services as cards */}
            <div className="flex flex-wrap gap-4 p-4 justify-center items-center h-full content-center">
              {!hasData && (
                <div className="text-sm text-zinc-500 text-center px-4">
                  No live service dependency data available for this cluster view yet.
                </div>
              )}
              {services.map((service) => {
                const borderClass =
                  service.status === "healthy"
                    ? "border-green-500/50"
                    : service.status === "warning"
                      ? "border-yellow-500/50"
                      : "border-red-500/50";

                return (
                  <div
                    key={service.id}
                    onClick={() => onSelectService?.(service.id)}
                    className={`px-4 py-2 rounded-lg border-2 cursor-pointer transition hover:scale-105 ${statusBg[service.status]} ${borderClass}`}
                  >
                    <div
                      className={`font-semibold ${statusColor[service.status]}`}
                    >
                      {service.name}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {service.replicas} replicas •{" "}
                      {service.traffic > 0 ? `${service.traffic} req/s` : "traffic n/a"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 text-xs text-zinc-400 space-y-1">
              <div className="font-semibold text-zinc-300">Legend</div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full" /> Healthy
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full" /> Warning
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full" /> Critical
              </div>
            </div>
          </div>

          {/* Dependencies table */}
          {dependencies.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">
                Dependencies
              </h4>
              <div className="space-y-2">
                {dependencies.map((dep, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded text-xs"
                  >
                    <span className="text-zinc-300">
                      {services.find((s) => s.id === dep.source)?.name || dep.source} →{" "}
                      {services.find((s) => s.id === dep.target)?.name || dep.target}
                    </span>
                    <span className="text-orange-400 font-mono">
                      {dep.latency}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface HealthMetric {
  label: string;
  value: number;
  total: number;
  status: "healthy" | "warning" | "critical";
}

interface ClusterHealthProps {
  pods: HealthMetric;
  nodes: HealthMetric;
  deployments: HealthMetric;
  services: HealthMetric;
}

const HealthCard = ({ label, value, total, status }: HealthMetric) => {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  const statusColors = {
    healthy: "bg-green-500",
    warning: "bg-yellow-500",
    critical: "bg-red-500",
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-sm text-zinc-400 mb-2">{label}</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold text-white">{value}</span>
        <span className="text-sm text-zinc-500">/ {total}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-zinc-800 rounded-full h-2">
          <div
            className={`h-full rounded-full ${statusColors[status]}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 w-8 text-right">
          {percentage}%
        </span>
      </div>
    </div>
  );
};

export const ClusterHealth = ({
  pods,
  nodes,
  deployments,
  services,
}: ClusterHealthProps) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-white mb-4">Cluster Health</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <HealthCard {...pods} />
        <HealthCard {...nodes} />
        <HealthCard {...deployments} />
        <HealthCard {...services} />
      </div>
    </div>
  );
};

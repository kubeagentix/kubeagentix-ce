import { Search, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface Resource {
  id: string;
  name: string;
  kind: string;
  namespace: string;
  status: "running" | "error" | "pending" | "warning";
  replicas?: string;
  age: string;
}

interface ResourceListProps {
  resources: Resource[];
  onSelectResource?: (resource: Resource) => void;
  title?: string;
}

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "running":
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case "error":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "pending":
      return <Clock className="w-4 h-4 text-yellow-500" />;
    case "warning":
      return <Clock className="w-4 h-4 text-yellow-500" />;
    default:
      return null;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  const statusClasses = {
    running: "status-running",
    error: "status-error",
    pending: "status-pending",
    warning: "status-pending",
  };

  const statusLabels = {
    running: "Running",
    error: "Error",
    pending: "Pending",
    warning: "Warning",
  };

  return (
    <span
      className={`status-badge ${statusClasses[status as keyof typeof statusClasses] || "status-unknown"}`}
    >
      <StatusIcon status={status} />
      {statusLabels[status as keyof typeof statusLabels]}
    </span>
  );
};

export const ResourceList = ({
  resources,
  onSelectResource,
  title = "Resources",
}: ResourceListProps) => {
  const [search, setSearch] = useState("");
  const filtered = resources.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>
      </div>

      <div className="divide-y divide-zinc-800 max-h-96 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-zinc-500">
            No resources found
          </div>
        ) : (
          filtered.map((resource) => (
            <div
              key={resource.id}
              onClick={() => onSelectResource?.(resource)}
              className="resource-item cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {resource.name}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {resource.kind} • {resource.namespace}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <StatusBadge status={resource.status} />
                {resource.replicas && (
                  <span className="text-xs text-zinc-500 w-12 text-right">
                    {resource.replicas}
                  </span>
                )}
                <span className="text-xs text-zinc-500 w-16 text-right">
                  {resource.age}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

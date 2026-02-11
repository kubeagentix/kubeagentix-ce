import { useState } from "react";
import { Plus, X, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Cluster {
  id: string;
  name: string;
  context: string;
  status: "connected" | "disconnected";
  isDefault?: boolean;
}

export function ClusterConfiguration() {
  const [clusters, setClusters] = useState<Cluster[]>([
    {
      id: "1",
      name: "Production",
      context: "prod-us-west",
      status: "connected",
      isDefault: true,
    },
    {
      id: "2",
      name: "Staging",
      context: "staging-us-east",
      status: "connected",
    },
  ]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContext, setNewContext] = useState("");

  const addCluster = () => {
    if (newName && newContext) {
      setClusters([
        ...clusters,
        {
          id: Date.now().toString(),
          name: newName,
          context: newContext,
          status: "disconnected",
        },
      ]);
      setNewName("");
      setNewContext("");
      setShowAdd(false);
    }
  };

  const removeCluster = (id: string) => {
    setClusters(clusters.filter((c) => c.id !== id));
  };

  const setDefault = (id: string) => {
    setClusters(
      clusters.map((c) => ({
        ...c,
        isDefault: c.id === id,
      })),
    );
  };

  return (
    <div className="space-y-4">
      {clusters.map((cluster) => (
        <div
          key={cluster.id}
          className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 flex items-center justify-between"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">{cluster.name}</h3>
              {cluster.isDefault && (
                <span className="text-xs px-2 py-1 bg-orange-700/50 text-orange-300 rounded">
                  Default
                </span>
              )}
            </div>
            <div className="text-sm text-zinc-400 font-mono">
              {cluster.context}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  cluster.status === "connected" ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-xs text-zinc-400">
                {cluster.status === "connected" ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {!cluster.isDefault && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDefault(cluster.id)}
                className="text-xs"
              >
                Set Default
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => removeCluster(cluster.id)}
              className="text-red-400 border-red-900 hover:bg-red-950"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}

      {!showAdd ? (
        <Button
          onClick={() => setShowAdd(true)}
          className="w-full bg-sky-400/60 hover:bg-sky-400/70"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Cluster
        </Button>
      ) : (
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Cluster name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-white"
          />
          <input
            type="text"
            placeholder="Kubernetes context"
            value={newContext}
            onChange={(e) => setNewContext(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-white"
          />
          <div className="flex gap-2">
            <Button
              onClick={addCluster}
              className="flex-1 bg-green-700 hover:bg-green-800"
            >
              Add
            </Button>
            <Button
              onClick={() => setShowAdd(false)}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

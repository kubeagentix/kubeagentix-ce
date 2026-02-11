import { getCommandBroker } from "../commands/broker";

const DEFAULT_NS = "default";

const RESOURCE_MAP: Record<string, string> = {
  pod: "pods",
  pods: "pods",
  namespace: "namespaces",
  namespaces: "namespaces",
  ns: "namespaces",
  deployment: "deployments",
  deployments: "deployments",
  service: "services",
  services: "services",
  statefulset: "statefulsets",
  statefulsets: "statefulsets",
  daemonset: "daemonsets",
  daemonsets: "daemonsets",
  job: "jobs",
  jobs: "jobs",
  cronjob: "cronjobs",
  cronjobs: "cronjobs",
  node: "nodes",
  nodes: "nodes",
  persistent_volume: "persistentvolumes",
  persistent_volumes: "persistentvolumes",
  persistentvolume: "persistentvolumes",
  persistentvolumes: "persistentvolumes",
  pv: "persistentvolumes",
  persistent_volume_claim: "persistentvolumeclaims",
  persistent_volume_claims: "persistentvolumeclaims",
  persistentvolumeclaim: "persistentvolumeclaims",
  persistentvolumeclaims: "persistentvolumeclaims",
  pvc: "persistentvolumeclaims",
};

const CLUSTER_SCOPED_RESOURCES = new Set([
  "nodes",
  "namespaces",
  "persistentvolumes",
]);

function normalizeResourceType(resourceType: string): string {
  return RESOURCE_MAP[resourceType.toLowerCase()] || resourceType;
}

function ageFrom(timestamp?: string): string {
  if (!timestamp) return "unknown";
  const createdAt = Date.parse(timestamp);
  if (Number.isNaN(createdAt)) return "unknown";

  const diffMs = Date.now() - createdAt;
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function mapResourceStatus(item: any): "running" | "error" | "warning" | "pending" {
  const kind = item?.kind;

  if (kind === "Namespace") {
    const phase = (item?.status?.phase || "").toLowerCase();
    if (phase === "active") return "running";
    if (phase === "terminating") return "warning";
    return "warning";
  }

  if (kind === "Pod") {
    const phase = item?.status?.phase;
    if (phase === "Running") return "running";
    if (phase === "Pending") return "pending";
    if (phase === "Failed") return "error";
    return "warning";
  }

  if (kind === "Deployment") {
    const desired = Number(item?.spec?.replicas || 0);
    const ready = Number(item?.status?.readyReplicas || 0);
    if (desired === 0) return "warning";
    if (ready === desired) return "running";
    if (ready === 0) return "error";
    return "warning";
  }

  const conditions = item?.status?.conditions;
  if (Array.isArray(conditions)) {
    const ready = conditions.find((c: any) => c.type === "Ready");
    if (ready?.status === "True") return "running";
    if (ready?.status === "False") return "warning";
  }

  return "running";
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function parseCpuMillicores(value?: string): number {
  if (!value) return 0;
  if (value.endsWith("m")) return parseFloat(value.replace("m", ""));
  const cores = parseFloat(value);
  return Number.isNaN(cores) ? 0 : cores * 1000;
}

function parseMemoryMi(value?: string): number {
  if (!value) return 0;
  const match = value.match(/^([0-9.]+)(Ki|Mi|Gi|Ti)?$/i);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  const unit = (match[2] || "Mi").toLowerCase();
  if (unit === "ki") return amount / 1024;
  if (unit === "mi") return amount;
  if (unit === "gi") return amount * 1024;
  if (unit === "ti") return amount * 1024 * 1024;
  return amount;
}

async function runCommand(
  command: string,
  timeoutMs?: number,
  maxOutputBytes?: number,
  clusterContext?: string,
) {
  return getCommandBroker().execute({
    command,
    timeoutMs,
    maxOutputBytes,
    clusterContext,
  });
}

export async function listResources(params: {
  resourceType: string;
  namespace?: string;
  context?: string;
  labelSelector?: string;
  limit?: number;
}) {
  const namespace = params.namespace || DEFAULT_NS;
  const resourceType = normalizeResourceType(params.resourceType);
  const selector = params.labelSelector ? ` -l ${params.labelSelector}` : "";
  const allNamespaces =
    namespace === "all" || namespace === "*" || namespace === "";
  const nsArg = CLUSTER_SCOPED_RESOURCES.has(resourceType)
    ? ""
    : allNamespaces
      ? " -A"
      : ` -n ${namespace}`;

  const result = await runCommand(
    `kubectl get ${resourceType}${nsArg}${selector} -o json`,
    20_000,
    2 * 1024 * 1024,
    params.context,
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to fetch resources");
  }

  const payload = parseJson<{ items: any[] }>(result.stdout || "{\"items\":[]}");
  const limit = Math.max(1, Math.min(params.limit || 50, 200));

  const resources = (payload.items || []).slice(0, limit).map((item) => {
    const kind = item?.kind || "Resource";
    const desired = Number(item?.spec?.replicas || 0);
    const ready = Number(item?.status?.readyReplicas || 0);

    return {
      id: `${kind}/${item?.metadata?.namespace || "default"}/${item?.metadata?.name}`,
      name: item?.metadata?.name || "unknown",
      kind,
      namespace:
        item?.metadata?.namespace ||
        (kind === "Namespace" ? item?.metadata?.name : namespace),
      status: mapResourceStatus(item),
      replicas:
        kind === "Deployment" || kind === "StatefulSet"
          ? `${ready}/${desired}`
          : undefined,
      age: ageFrom(item?.metadata?.creationTimestamp),
      labels: item?.metadata?.labels || {},
      annotations: item?.metadata?.annotations || {},
    };
  });

  return { resources, count: resources.length };
}

export async function describeResource(params: {
  resourceType: string;
  name: string;
  namespace?: string;
  context?: string;
}) {
  const namespace = params.namespace || DEFAULT_NS;
  const resourceType = normalizeResourceType(params.resourceType);
  const nsArg = resourceType === "nodes" ? "" : ` -n ${namespace}`;

  const jsonResult = await runCommand(
    `kubectl get ${resourceType} ${params.name}${nsArg} -o json`,
    20_000,
    2 * 1024 * 1024,
    params.context,
  );

  if (jsonResult.exitCode !== 0) {
    throw new Error(jsonResult.stderr || "Failed to fetch resource");
  }

  const yamlResult = await runCommand(
    `kubectl get ${resourceType} ${params.name}${nsArg} -o yaml`,
    20_000,
    undefined,
    params.context,
  );

  return {
    resource: parseJson<any>(jsonResult.stdout),
    yaml: yamlResult.stdout,
  };
}

export async function getPodLogs(params: {
  podName: string;
  namespace?: string;
  context?: string;
  container?: string;
  lines?: number;
  since?: string;
}) {
  const namespace = params.namespace || DEFAULT_NS;
  const lines = Math.max(1, Math.min(params.lines || 50, 10_000));
  const containerArg = params.container ? ` -c ${params.container}` : "";
  const sinceArg = params.since ? ` --since ${params.since}` : "";

  const result = await runCommand(
    `kubectl logs ${params.podName} -n ${namespace}${containerArg} --tail ${lines}${sinceArg}`,
    20_000,
    undefined,
    params.context,
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to fetch pod logs");
  }

  return {
    pod: params.podName,
    namespace,
    container: params.container,
    logs: result.stdout,
    truncated: result.truncated || false,
  };
}

export async function getEvents(params: {
  namespace?: string;
  context?: string;
  resourceType?: string;
  resourceName?: string;
  limit?: number;
}) {
  const namespace = params.namespace;
  const nsArg = namespace && namespace !== "all" ? `-n ${namespace}` : "-A";

  const result = await runCommand(
    `kubectl get events ${nsArg} -o json`,
    20_000,
    2 * 1024 * 1024,
    params.context,
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to fetch events");
  }

  const payload = parseJson<{ items: any[] }>(result.stdout || "{\"items\":[]}");

  let items = payload.items || [];
  if (params.resourceType) {
    items = items.filter(
      (item) =>
        (item?.involvedObject?.kind || "").toLowerCase() ===
        params.resourceType?.toLowerCase(),
    );
  }

  if (params.resourceName) {
    items = items.filter(
      (item) => item?.involvedObject?.name === params.resourceName,
    );
  }

  const limit = Math.max(1, Math.min(params.limit || 20, 200));

  const events = items.slice(0, limit).map((item) => {
    const type = (item?.type || "Normal").toLowerCase();
    const mappedType =
      type === "warning"
        ? "warning"
        : type === "normal"
          ? "info"
          : "critical";

    return {
      id: `${item?.metadata?.namespace || "default"}/${item?.metadata?.name}`,
      type: mappedType,
      title: item?.reason || "Cluster Event",
      description: item?.message || "",
      timestamp:
        item?.lastTimestamp ||
        item?.eventTime ||
        item?.firstTimestamp ||
        new Date().toISOString(),
      involvedObject: item?.involvedObject
        ? {
            kind: item.involvedObject.kind,
            name: item.involvedObject.name,
            namespace: item.involvedObject.namespace,
          }
        : undefined,
    };
  });

  return { events, count: events.length };
}

export async function getKubeContexts() {
  const [contextsResult, currentContextResult] = await Promise.all([
    runCommand("kubectl config get-contexts -o name", 10_000),
    runCommand("kubectl config current-context", 10_000),
  ]);

  if (contextsResult.exitCode !== 0) {
    throw new Error(contextsResult.stderr || "Failed to fetch Kubernetes contexts");
  }

  const contexts = contextsResult.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const currentContext =
    currentContextResult.exitCode === 0
      ? currentContextResult.stdout.trim()
      : contexts[0] || "";

  return {
    contexts,
    currentContext,
  };
}

export async function getClusterMetrics(params?: { context?: string }) {
  const [nodeTop, podTop, podList, nodeList, deploymentList, serviceList] = await Promise.all([
    runCommand("kubectl top nodes --no-headers", 15_000, undefined, params?.context),
    runCommand("kubectl top pods -A --no-headers", 15_000, undefined, params?.context),
    runCommand("kubectl get pods -A -o json", 15_000, 4 * 1024 * 1024, params?.context),
    runCommand("kubectl get nodes -o json", 15_000, 2 * 1024 * 1024, params?.context),
    runCommand("kubectl get deployments -A -o json", 15_000, 2 * 1024 * 1024, params?.context),
    runCommand("kubectl get services -A -o json", 15_000, 2 * 1024 * 1024, params?.context),
  ]);

  if (nodeTop.exitCode !== 0 || podTop.exitCode !== 0) {
    throw new Error(nodeTop.stderr || podTop.stderr || "Failed to fetch metrics");
  }

  const nodeLines = nodeTop.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let cpuUsage = 0;
  let cpuTotal = 0;
  let memoryUsage = 0;
  let memoryTotal = 0;

  nodeLines.forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length < 5) return;

    const cpu = parseCpuMillicores(parts[1]);
    const cpuPct = parseFloat((parts[2] || "0").replace("%", ""));
    const mem = parseMemoryMi(parts[3]);
    const memPct = parseFloat((parts[4] || "0").replace("%", ""));

    cpuUsage += cpu;
    memoryUsage += mem;

    cpuTotal += cpuPct > 0 ? cpu / (cpuPct / 100) : cpu;
    memoryTotal += memPct > 0 ? mem / (memPct / 100) : mem;
  });

  const podsPayload = podList.exitCode === 0
    ? parseJson<{ items: any[] }>(podList.stdout || "{\"items\":[]}")
    : { items: [] };

  const nodesPayload = nodeList.exitCode === 0
    ? parseJson<{ items: any[] }>(nodeList.stdout || "{\"items\":[]}")
    : { items: [] };

  const deploymentsPayload = deploymentList.exitCode === 0
    ? parseJson<{ items: any[] }>(deploymentList.stdout || "{\"items\":[]}")
    : { items: [] };

  const servicesPayload = serviceList.exitCode === 0
    ? parseJson<{ items: any[] }>(serviceList.stdout || "{\"items\":[]}")
    : { items: [] };

  return {
    cpu: {
      usage: Math.round(cpuUsage),
      total: Math.max(Math.round(cpuTotal), Math.round(cpuUsage), 1),
      percentage:
        cpuTotal > 0 ? Number(((cpuUsage / cpuTotal) * 100).toFixed(1)) : 0,
    },
    memory: {
      usage: Math.round(memoryUsage),
      total: Math.max(Math.round(memoryTotal), Math.round(memoryUsage), 1),
      percentage:
        memoryTotal > 0
          ? Number(((memoryUsage / memoryTotal) * 100).toFixed(1))
          : 0,
    },
    network: {
      in: 0,
      out: 0,
    },
    disk: {
      usage: 0,
      total: 0,
    },
    podCount: podsPayload.items.length,
    nodeCount: nodesPayload.items.length,
    deploymentCount: deploymentsPayload.items.length,
    serviceCount: servicesPayload.items.length,
  };
}

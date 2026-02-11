import {
  ToolDefinition,
  ToolHandler,
  RequestContext,
} from "@shared/coordination";
import {
  listResources,
  describeResource,
  getPodLogs,
  getEvents,
  getClusterMetrics,
} from "../services/k8s";
import { getCommandBroker } from "../commands/broker";
import { executeSkill, getSkillById, listSkills } from "../services/skills";

/**
 * Kubernetes operation tools
 */
export const k8sTools = {
  list_namespaces: {
    name: "list_namespaces",
    description: "List namespaces the current Kubernetes context can access",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum namespaces to return",
          default: 200,
        },
      },
      required: [],
    },
  } as ToolDefinition,

  list_non_running_pods: {
    name: "list_non_running_pods",
    description:
      "List pods that are not in Running state (supports namespace=all)",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        namespace: {
          type: "string",
          description:
            "Kubernetes namespace, or 'all' for all namespaces",
          default: "all",
        },
        limit: {
          type: "number",
          description: "Maximum number of pods to return",
          default: 100,
        },
      },
      required: [],
    },
  } as ToolDefinition,

  list_resources: {
    name: "list_resources",
    description:
      "List Kubernetes resources (pods, services, deployments, etc.)",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        resource_type: {
          type: "string",
          description:
            "Type of resource (pod, service, deployment, statefulset, etc.)",
          enum: [
            "pod",
            "namespace",
            "service",
            "deployment",
            "statefulset",
            "daemonset",
            "job",
            "cronjob",
            "node",
            "persistent_volume",
            "persistentvolume",
            "persistent_volume_claim",
            "persistentvolumeclaim",
          ],
        },
        namespace: {
          type: "string",
          description: "Kubernetes namespace, or 'all' for all namespaces",
          default: "default",
        },
        label_selector: {
          type: "string",
          description: "Label selector (e.g., 'app=payment-service')",
        },
        limit: {
          type: "number",
          description: "Maximum number of resources to return",
          default: 50,
        },
      },
      required: ["resource_type"],
    },
  } as ToolDefinition,

  describe_resource: {
    name: "describe_resource",
    description:
      "Get detailed information about a specific Kubernetes resource",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        resource_type: {
          type: "string",
          description: "Type of resource (pod, service, deployment, etc.)",
        },
        name: {
          type: "string",
          description: "Name of the resource",
        },
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
      },
      required: ["resource_type", "name"],
    },
  } as ToolDefinition,

  get_pod_logs: {
    name: "get_pod_logs",
    description: "Get logs from a pod",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        pod_name: {
          type: "string",
          description: "Name of the pod",
        },
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
        container: {
          type: "string",
          description: "Container name (if multiple containers)",
        },
        lines: {
          type: "number",
          description: "Number of log lines to retrieve",
          default: 50,
        },
        since: {
          type: "string",
          description: "Time duration (e.g., '10m', '1h')",
        },
      },
      required: ["pod_name"],
    },
  } as ToolDefinition,

  get_resource_events: {
    name: "get_resource_events",
    description: "Get Kubernetes events for a namespace or resource, with optional event type filtering (warning/info/critical)",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
        resource_type: {
          type: "string",
          description: "Filter by resource type (optional)",
        },
        resource_name: {
          type: "string",
          description: "Filter by resource name (optional)",
        },
        event_type: {
          type: "string",
          description: "Filter event type: all, warning, info, critical (normal maps to info)",
          enum: ["all", "warning", "info", "critical", "normal"],
          default: "all",
        },
        limit: {
          type: "number",
          description: "Maximum events to return",
          default: 20,
        },
      },
      required: [],
    },
  } as ToolDefinition,

  get_pod_metrics: {
    name: "get_pod_metrics",
    description: "Get CPU, memory, and network metrics for a pod",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        pod_name: {
          type: "string",
          description: "Name of the pod",
        },
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
      },
      required: ["pod_name"],
    },
  } as ToolDefinition,

  execute_kubectl: {
    name: "execute_kubectl",
    description: "Execute a kubectl command (restricted safe commands only)",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "kubectl command to execute (read-only commands only)",
        },
      },
      required: ["command"],
    },
  } as ToolDefinition,
};

/**
 * Observability and metrics tools
 */
export const observabilityTools = {
  query_metrics: {
    name: "query_metrics",
    description: "Query Prometheus metrics using PromQL",
    category: "observability" as const,
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "PromQL query (e.g., 'rate(http_requests_total[5m])')",
        },
        duration: {
          type: "string",
          description: "Time range (e.g., '1h', '24h')",
          default: "1h",
        },
        step: {
          type: "string",
          description: "Step size for range queries (e.g., '1m', '5m')",
          default: "1m",
        },
      },
      required: ["query"],
    },
  } as ToolDefinition,

  query_logs: {
    name: "query_logs",
    description: "Query logs from Loki or pod logs",
    category: "observability" as const,
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Log query (LogQL or simple text search)",
        },
        duration: {
          type: "string",
          description: "Time range (e.g., '1h', '24h')",
          default: "1h",
        },
        limit: {
          type: "number",
          description: "Maximum number of log entries",
          default: 100,
        },
      },
      required: ["query"],
    },
  } as ToolDefinition,

  get_metric_anomalies: {
    name: "get_metric_anomalies",
    description: "Detect anomalies in metrics using ML models",
    category: "observability" as const,
    parameters: {
      type: "object" as const,
      properties: {
        metric_name: {
          type: "string",
          description: "Prometheus metric name",
        },
        duration: {
          type: "string",
          description: "Analysis duration",
          default: "24h",
        },
        sensitivity: {
          type: "string",
          description: "Anomaly sensitivity (low, medium, high)",
          default: "medium",
          enum: ["low", "medium", "high"],
        },
      },
      required: ["metric_name"],
    },
  } as ToolDefinition,

  get_service_dependencies: {
    name: "get_service_dependencies",
    description: "Get service dependency graph and interactions",
    category: "observability" as const,
    parameters: {
      type: "object" as const,
      properties: {
        service_name: {
          type: "string",
          description: "Service to analyze dependencies for",
        },
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
      },
      required: ["service_name"],
    },
  } as ToolDefinition,
};

/**
 * Runbook and remediation tools
 */
export const runbookTools = {
  list_runbooks: {
    name: "list_runbooks",
    description: "Search and list available runbooks",
    category: "runbook" as const,
    parameters: {
      type: "object" as const,
      properties: {
        search_query: {
          type: "string",
          description: "Search term (e.g., 'memory leak', 'pod crash')",
        },
        tags: {
          type: "string",
          description: "Filter by tags (comma-separated)",
        },
        limit: {
          type: "number",
          description: "Maximum runbooks to return",
          default: 10,
        },
      },
      required: [],
    },
  } as ToolDefinition,

  get_runbook: {
    name: "get_runbook",
    description: "Get full details of a specific runbook",
    category: "runbook" as const,
    parameters: {
      type: "object" as const,
      properties: {
        runbook_id: {
          type: "string",
          description: "ID or name of the runbook",
        },
      },
      required: ["runbook_id"],
    },
  } as ToolDefinition,

  execute_runbook: {
    name: "execute_runbook",
    description: "Execute a runbook with given parameters",
    category: "runbook" as const,
    parameters: {
      type: "object" as const,
      properties: {
        runbook_id: {
          type: "string",
          description: "ID of the runbook to execute",
        },
        parameters: {
          type: "object",
          description: "Parameters to pass to the runbook",
        },
        dry_run: {
          type: "boolean",
          description: "Preview execution without making changes",
          default: true,
        },
      },
      required: ["runbook_id"],
    },
  } as ToolDefinition,
};

/**
 * Analysis and investigation tools
 */
export const analysisTools = {
  correlate_metrics: {
    name: "correlate_metrics",
    description: "Find correlated metrics to identify root causes",
    category: "observability" as const,
    parameters: {
      type: "object" as const,
      properties: {
        primary_metric: {
          type: "string",
          description: "Main metric showing the problem",
        },
        duration: {
          type: "string",
          description: "Time range to analyze",
          default: "1h",
        },
        correlation_threshold: {
          type: "number",
          description: "Minimum correlation coefficient (0-1)",
          default: 0.7,
        },
      },
      required: ["primary_metric"],
    },
  } as ToolDefinition,

  get_recent_changes: {
    name: "get_recent_changes",
    description: "Get recent deployments, config changes, and cluster changes",
    category: "k8s" as const,
    parameters: {
      type: "object" as const,
      properties: {
        namespace: {
          type: "string",
          description: "Kubernetes namespace",
          default: "default",
        },
        hours: {
          type: "number",
          description: "Look back this many hours",
          default: 24,
        },
      },
      required: [],
    },
  } as ToolDefinition,
};

/**
 * Tool handlers - implementations of tool logic
 */
const MAX_TOOL_STRING = 8_000;

function truncateString(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_TOOL_STRING) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, MAX_TOOL_STRING)}\n...[TRUNCATED]`,
    truncated: true,
  };
}

function truncateDeep(input: any): any {
  if (typeof input === "string") {
    const truncated = truncateString(input);
    return truncated.value;
  }

  if (Array.isArray(input)) {
    return input.map((item) => truncateDeep(item));
  }

  if (input && typeof input === "object") {
    const output: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = truncateDeep(value);
    }
    return output;
  }

  return input;
}

export const toolHandlers = new Map<string, ToolHandler>([
  [
    "list_namespaces",
    async (args, context) => {
      const result = await listResources({
        resourceType: "namespace",
        namespace: "all",
        context: context?.clusterContext || context?.cluster,
        limit: args.limit || 200,
      });

      return truncateDeep({
        namespaces: result.resources.map((resource) => ({
          name: resource.name,
          status: resource.status,
          age: resource.age,
        })),
        count: result.count,
      });
    },
  ],
  [
    "list_non_running_pods",
    async (args, context) => {
      const requestedNamespace = args.namespace || "all";
      const namespace = requestedNamespace === "*" ? "all" : requestedNamespace;

      const result = await listResources({
        resourceType: "pod",
        namespace,
        context: context?.clusterContext || context?.cluster,
        limit: args.limit || 100,
      });

      const nonRunningPods = result.resources.filter(
        (resource) => resource.status !== "running",
      );

      return truncateDeep({
        namespace,
        pods: nonRunningPods,
        count: nonRunningPods.length,
        totalPodsScanned: result.count,
      });
    },
  ],
  [
    "list_resources",
    async (args, context) => {
      const result = await listResources({
        resourceType: args.resource_type,
        namespace: args.namespace || context?.namespace || "default",
        context: context?.clusterContext || context?.cluster,
        labelSelector: args.label_selector,
        limit: args.limit,
      });

      return truncateDeep({
        ...result,
        items: result.resources,
      });
    },
  ],
  [
    "describe_resource",
    async (args, context) => {
      const result = await describeResource({
        resourceType: args.resource_type,
        name: args.name,
        namespace: args.namespace || context?.namespace || "default",
        context: context?.clusterContext || context?.cluster,
      });

      return truncateDeep({
        kind: result.resource?.kind,
        name: result.resource?.metadata?.name,
        namespace: result.resource?.metadata?.namespace,
        details: result.resource,
        yaml: result.yaml,
      });
    },
  ],
  [
    "get_pod_logs",
    async (args, context) => {
      const result = await getPodLogs({
        podName: args.pod_name,
        namespace: args.namespace || context?.namespace || "default",
        context: context?.clusterContext || context?.cluster,
        container: args.container,
        lines: args.lines,
        since: args.since,
      });
      const logs = truncateString(result.logs);

      return {
        podName: args.pod_name,
        namespace: args.namespace || context?.namespace || "default",
        logs: logs.value,
        truncated: result.truncated || logs.truncated,
      };
    },
  ],
  [
    "get_resource_events",
    async (args, context) => {
      const normalizeEventType = (value: unknown): "all" | "warning" | "info" | "critical" => {
        const type = String(value || "all").toLowerCase();
        if (type === "warning") return "warning";
        if (type === "critical") return "critical";
        if (type === "info" || type === "normal") return "info";
        return "all";
      };

      const requestedType = normalizeEventType(args.event_type);
      const result = await getEvents({
        namespace: args.namespace || context?.namespace || "default",
        context: context?.clusterContext || context?.cluster,
        resourceType: args.resource_type,
        resourceName: args.resource_name,
        limit: args.limit,
      });

      const filteredEvents =
        requestedType === "all"
          ? result.events
          : result.events.filter((event) => event.type === requestedType);

      return truncateDeep({
        ...result,
        eventType: requestedType,
        totalCount: result.events.length,
        events: filteredEvents,
        count: filteredEvents.length,
      });
    },
  ],
  [
    "get_pod_metrics",
    async (args, context) => {
      const metrics = await getClusterMetrics({
        context: context?.clusterContext || context?.cluster,
      });
      return truncateDeep({
        pod: args.pod_name,
        namespace: args.namespace || context?.namespace || "default",
        clusterMetrics: metrics,
      });
    },
  ],
  [
    "query_metrics",
    async (args, context) => {
      const metrics = await getClusterMetrics({
        context: context?.clusterContext || context?.cluster,
      });
      return truncateDeep({
        query: args.query,
        duration: args.duration || "1h",
        step: args.step || "1m",
        results: metrics,
        timestamps: [Date.now()],
      });
    },
  ],
  [
    "list_runbooks",
    async () => {
      const skills = await listSkills();
      return truncateDeep({
        runbooks: skills,
        count: skills.length,
      });
    },
  ],
  [
    "get_runbook",
    async (args) => {
      const skill = await getSkillById(String(args.runbook_id));
      if (!skill) {
        return {
          error: `Unknown runbook: ${args.runbook_id}`,
        };
      }
      return truncateDeep({ runbook: skill });
    },
  ],
  [
    "execute_runbook",
    async (args, context) => {
      const execution = await executeSkill(String(args.runbook_id), {
        dryRun: args.dry_run !== false,
        context: context?.clusterContext || context?.cluster,
        namespace: args.namespace || context?.namespace,
        input: args.parameters || {},
      });

      if (!execution) {
        return {
          runbookId: String(args.runbook_id),
          dryRun: args.dry_run !== false,
          status: "failed",
          output: {},
          error: `Unknown runbook: ${String(args.runbook_id)}`,
        };
      }

      return truncateDeep({
        runbookId: execution.skill.id,
        dryRun: execution.dryRun,
        status: execution.status,
        output: execution.steps,
      });
    },
  ],
  [
    "execute_kubectl",
    async (args) => {
      const exec = await getCommandBroker().execute({
        command: `kubectl ${args.command}`.trim(),
      });

      return truncateDeep({
        stdout: exec.stdout,
        stderr: exec.stderr,
        exitCode: exec.exitCode,
        truncated: exec.truncated,
      });
    },
  ],
]);

/**
 * Get all available tools as definitions
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return [
    ...Object.values(k8sTools),
    ...Object.values(observabilityTools),
    ...Object.values(runbookTools),
    ...Object.values(analysisTools),
  ];
}

/**
 * Get tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  const allTools = getAllToolDefinitions();
  return allTools.find((t) => t.name === name);
}

/**
 * Get tool handler by name
 */
export function getToolHandler(name: string): ToolHandler | undefined {
  return toolHandlers.get(name);
}

import { RequestHandler } from "express";
import {
  describeResource,
  getKubeContexts,
  getClusterMetrics,
  getEvents,
  getPodLogs,
  listResources,
} from "../services/k8s";

export const handleListResources: RequestHandler = async (req, res) => {
  try {
    const { resourceType } = req.params;
    const { namespace, labelSelector, limit, context, clusterContext } = req.query;

    const result = await listResources({
      resourceType,
      namespace: typeof namespace === "string" ? namespace : undefined,
      context:
        typeof clusterContext === "string"
          ? clusterContext
          : typeof context === "string"
            ? context
            : undefined,
      labelSelector:
        typeof labelSelector === "string" ? labelSelector : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list resources",
      code: "K8S_LIST_RESOURCES_ERROR",
    });
  }
};

export const handleDescribeResource: RequestHandler = async (req, res) => {
  try {
    const { resourceType, name } = req.params;
    const { namespace, context, clusterContext } = req.query;

    const result = await describeResource({
      resourceType,
      name,
      namespace: typeof namespace === "string" ? namespace : undefined,
      context:
        typeof clusterContext === "string"
          ? clusterContext
          : typeof context === "string"
            ? context
            : undefined,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to describe resource",
      code: "K8S_DESCRIBE_RESOURCE_ERROR",
    });
  }
};

export const handleGetPodLogs: RequestHandler = async (req, res) => {
  try {
    const { podName } = req.params;
    const { namespace, container, lines, since, context, clusterContext } = req.query;

    const result = await getPodLogs({
      podName,
      namespace: typeof namespace === "string" ? namespace : undefined,
      context:
        typeof clusterContext === "string"
          ? clusterContext
          : typeof context === "string"
            ? context
            : undefined,
      container: typeof container === "string" ? container : undefined,
      lines: typeof lines === "string" ? Number(lines) : undefined,
      since: typeof since === "string" ? since : undefined,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch pod logs",
      code: "K8S_GET_POD_LOGS_ERROR",
    });
  }
};

export const handleGetEvents: RequestHandler = async (req, res) => {
  try {
    const { namespace, resourceType, resourceName, limit, context, clusterContext } = req.query;

    const result = await getEvents({
      namespace: typeof namespace === "string" ? namespace : undefined,
      context:
        typeof clusterContext === "string"
          ? clusterContext
          : typeof context === "string"
            ? context
            : undefined,
      resourceType: typeof resourceType === "string" ? resourceType : undefined,
      resourceName: typeof resourceName === "string" ? resourceName : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch events",
      code: "K8S_GET_EVENTS_ERROR",
    });
  }
};

export const handleGetMetrics: RequestHandler = async (req, res) => {
  try {
    const { context, clusterContext } = req.query;
    const metrics = await getClusterMetrics({
      context:
        typeof clusterContext === "string"
          ? clusterContext
          : typeof context === "string"
            ? context
            : undefined,
    });
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch metrics",
      code: "K8S_GET_METRICS_ERROR",
    });
  }
};

export const handleGetContexts: RequestHandler = async (_req, res) => {
  try {
    const contexts = await getKubeContexts();
    res.json(contexts);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch contexts",
      code: "K8S_GET_CONTEXTS_ERROR",
    });
  }
};

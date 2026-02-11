/**
 * Kubernetes Resource Types and Interfaces
 */

export interface K8sResource<
  TSpec = Record<string, unknown>,
  TStatus = Record<string, unknown>,
> {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp: string;
  };
  spec: TSpec;
  status: TStatus;
}

export interface Pod extends K8sResource<Record<string, unknown>, PodStatus> {
  kind: "Pod";
}

export interface PodStatus {
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
  conditions: PodCondition[];
  containerStatuses: ContainerStatus[];
}

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: {
    running?: { startedAt: string };
    waiting?: { reason: string };
    terminated?: { exitCode: number };
  };
}

export interface PodCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  lastProbeTime: string;
  lastTransitionTime: string;
  reason: string;
  message: string;
}

export interface Deployment
  extends K8sResource<
    {
      replicas: number;
      selector: { matchLabels: Record<string, string> };
      template: Record<string, unknown>;
    },
    DeploymentStatus
  > {
  kind: "Deployment";
}

export interface DeploymentStatus {
  replicas: number;
  updatedReplicas: number;
  readyReplicas: number;
  availableReplicas: number;
  observedGeneration: number;
  conditions: Array<{
    type: string;
    status: "True" | "False";
    reason: string;
    message: string;
  }>;
}

export interface Service
  extends K8sResource<
    {
      type: "ClusterIP" | "NodePort" | "LoadBalancer";
      ports: Array<{
        name: string;
        port: number;
        targetPort: string | number;
        protocol: "TCP" | "UDP";
      }>;
      selector: Record<string, string>;
    },
    {
      loadBalancer?: { ingress: Array<{ ip?: string; hostname?: string }> };
    }
  > {
  kind: "Service";
}

export interface Node
  extends K8sResource<
    Record<string, unknown>,
    {
      capacity: Record<string, string>;
      allocatable: Record<string, string>;
      conditions: Array<{
        type: string;
        status: "True" | "False" | "Unknown";
        reason: string;
      }>;
    }
  > {
  kind: "Node";
}

export interface K8sEvent {
  apiVersion: string;
  kind: "Event";
  metadata: {
    name: string;
    namespace: string;
  };
  involvedObject: {
    apiVersion: string;
    kind: string;
    name: string;
    namespace: string;
  };
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  source: { component: string };
  firstTimestamp: string;
  lastTimestamp: string;
  count: number;
}

export interface K8sLog {
  pod: string;
  namespace: string;
  container: string;
  lines: string[];
}

export interface K8sMetrics {
  pod: string;
  namespace: string;
  containers: Array<{
    name: string;
    cpu: string; // e.g., "100m"
    memory: string; // e.g., "128Mi"
  }>;
}

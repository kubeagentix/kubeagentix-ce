/**
 * Shared types and interfaces for KubeAgentiX coordination system
 * Used by both desktop client and central server
 */

/**
 * Core agent message structure
 */
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * Request context containing cluster/resource information
 */
export interface RequestContext {
  cluster: string;
  namespace: string;
  clusterContext?: string;
  scopeId?: string;
  workingNamespace?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  environment?: "dev" | "stage" | "prod" | "unknown";
  clientLabel?: string;
  selectedResources?: string[]; // e.g., ["pod/xyz", "service/abc"]
  timeRange?: string; // e.g., "1h", "24h", "7d"
}

/**
 * Tool preferences controlling which tools are available
 */
export interface ToolPreferences {
  selectedTools?: string[]; // Explicitly selected tools
  excludedTools?: string[]; // Explicitly excluded tools
  maxToolCalls?: number; // Max tool calls per turn (default: 5)
  toolTimeout?: number; // Individual tool timeout in ms
}

/**
 * Model preferences for LLM selection
 */
export interface ModelPreferences {
  providerId?: string; // "claude_code" | "claude" | "openai" | "gemini" | "ollama"
  model?: string; // Specific model name
  apiKey?: string; // Optional per-request credential override
  authToken?: string; // Optional per-request bearer token override
  temperature?: number; // 0-1
  maxTokens?: number;
  useExtendedThinking?: boolean; // For Claude extended thinking
}

/**
 * Main agent request type - sent from desktop to server
 */
export interface AgentRequest {
  conversationId: string;
  userId: string;
  tenantId?: string; // For multi-tenant server

  messages: AgentMessage[];
  context: RequestContext;

  toolPreferences?: ToolPreferences;
  modelPreferences?: ModelPreferences;
}

/**
 * Possible response chunk types in streaming response
 */
export type AgentResponseChunkType =
  | "thinking" // LLM's internal reasoning
  | "tool_call" // LLM wants to call a tool
  | "tool_result" // Result from tool execution
  | "text" // Response text
  | "complete" // End of response
  | "error"; // Error occurred

/**
 * Individual tool call made by LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Tool result from execution
 */
export interface ToolResult {
  callId: string;
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Summary information for completed response
 */
export interface ResponseSummary {
  toolCallCount: number;
  executionTimeMs: number;
  tokensUsed?: number;
}

/**
 * Streaming response chunk
 */
export interface AgentResponseChunk {
  type: AgentResponseChunkType;
  chunkId: string;
  timestamp: number;

  // For "thinking" type
  content?: string;

  // For "tool_call" type
  toolCall?: ToolCall;

  // For "tool_result" type
  toolResult?: ToolResult;

  // For "text" type
  text?: string;
  isDone?: boolean;

  // For "complete" type
  summary?: ResponseSummary;

  // For "error" type
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/**
 * Tool definition describing what a tool does and how to call it
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: "k8s" | "observability" | "runbook" | "custom";

  // JSON Schema for parameters
  parameters: {
    type: "object";
    properties: {
      [key: string]: {
        type: string;
        description: string;
        default?: any;
        enum?: string[];
      };
    };
    required: string[];
  };

  // Rate limiting & cost
  rateLimit?: {
    callsPerMinute?: number;
    callsPerHour?: number;
  };
  costPerCall?: number;

  // Permissions required to call this tool
  requiredPermissions?: string[];

  // Execution constraints
  timeout?: number;
  cacheResults?: boolean;
  cacheTTL?: number;
}

/**
 * Tool handler function
 */
export type ToolHandler = (
  args: Record<string, any>,
  context?: RequestContext,
) => Promise<any>;

/**
 * LLM provider interface
 */
export interface LLMProvider {
  id: string; // "claude" | "openai" | "gemini" | "ollama"
  name: string;

  // Model capabilities
  supportedModels: string[];
  defaultModel: string;
  contextWindowSize: number;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsVision?: boolean;
  supportsExtendedThinking?: boolean;

  // Pricing (if applicable)
  costPer1kInputTokens?: number;
  costPer1kOutputTokens?: number;

  // API configuration
  apiEndpoint?: string;
  apiKeyRequired: boolean;

  // Priority for load balancing
  priority?: number;
}

/**
 * Runbook step for procedural remediation
 */
export interface PlaybookStep {
  name: string;
  description?: string;
  type: "kubectl" | "query" | "tool" | "manual" | "runbook";
  command?: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  expectedOutput?: string;
  onError?: "stop" | "continue" | "retry";
  timeout?: number;
}

/**
 * Runbook/Playbook definition
 */
export interface Playbook {
  id: string;
  title: string;
  description: string;
  tags: string[];

  // Trigger conditions
  triggers?: {
    metric?: string;
    threshold?: string | number;
    duration?: string;
  }[];

  // Steps to execute
  steps: PlaybookStep[];

  // Success validation
  successCriteria?: string[];

  // Metadata
  createdBy?: string;
  createdAt: number;
  updatedAt?: number;
  usageCount?: number;
  successRate?: number;
  averageResolutionTimeMs?: number;
}

/**
 * Stored conversation for learning and replay
 */
export interface StoredConversation {
  id: string;
  userId: string;
  tenantId?: string;

  // Context
  cluster: string;
  namespace?: string;
  selectedResources?: string[];

  // Messages and interactions
  messages: AgentMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];

  // Outcome
  outcome: "resolved" | "partial" | "failed" | "in_progress";
  resolutionTimeMs?: number;

  // Learning
  feedbackScore?: number; // 1-5
  userFeedback?: string;
  generatedPlaybook?: Playbook;

  // Timestamps
  createdAt: number;
  resolvedAt?: number;
  lastUpdatedAt: number;
}

/**
 * Agent configuration for a specific user/cluster
 */
export interface AgentConfig {
  userId: string;
  tenantId?: string;
  cluster: string;

  // Tool preferences
  enabledTools?: string[];
  disabledTools?: string[];
  maxToolCallsPerTurn?: number;

  // Model preferences
  preferredProvider?: string;
  preferredModel?: string;

  // Behavior
  autoExecuteRunbooks?: boolean;
  requireApprovalForDangerous?: boolean;
  enableExtendedThinking?: boolean;
  enableLearning?: boolean;

  // Data
  storageQuotaBytes?: number;
  conversationRetentionDays?: number;

  createdAt: number;
  updatedAt?: number;
}

/**
 * Error type for agent operations
 */
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/**
 * Statistics about agent usage
 */
export interface AgentStats {
  totalConversations: number;
  totalToolCalls: number;
  averageResponseTimeMs: number;
  successRate: number;
  topTools: Array<{ name: string; count: number }>;
  topIssues: Array<{ type: string; count: number }>;
  averagePlaybookQuality?: number;
}

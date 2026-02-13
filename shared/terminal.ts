/**
 * Terminal and Command Types
 */

export interface TerminalCommand {
  command: string;
  context?: string;
  clusterContext?: string;
  scopeId?: string;
  workingNamespace?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  namespace?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TerminalResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  executedAt: number;
  durationMs?: number;
}

export interface TerminalSession {
  id: string;
  context: string;
  namespace: string;
  scopeId?: string;
  clusterContext?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  isActive: boolean;
  createdAt: number;
  lastCommandAt?: number;
}

export interface TerminalHistory {
  sessionId: string;
  commands: Array<{
    input: string;
    output: TerminalResponse;
    timestamp: number;
  }>;
}

export type CommandFamily = "kubectl" | "docker" | "git" | "sh";

export interface CommandPolicyDecision {
  allowed: boolean;
  family?: CommandFamily;
  subcommand?: string;
  reason?: string;
  matchedRule?: string;
}

export interface BrokerExecuteRequest extends TerminalCommand {}

export interface BrokerExecuteResponse extends TerminalResponse {
  policyDecision: CommandPolicyDecision;
  truncated?: boolean;
}

export type SuggestionSource = "agentic" | "heuristic";

export interface BrokerSuggestRequest {
  query: string;
  context?: string;
  clusterContext?: string;
  scopeId?: string;
  workingNamespace?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  namespace?: string;
  recentTerminalContext?: Array<{
    type: "input" | "output" | "error";
    content: string;
  }>;
  modelPreferences?: {
    providerId?: string;
    model?: string;
    apiKey?: string;
    authToken?: string;
  };
}

export interface BrokerSuggestResponse {
  query: string;
  suggestedCommand: string;
  source: SuggestionSource;
  confidence: number;
  rationale: string;
  assumptions: string[];
  warnings: string[];
  policyDecision: CommandPolicyDecision;
  generatedAt: number;
}

export interface BrokerError {
  code:
    | "COMMAND_BLOCKED"
    | "COMMAND_INVALID"
    | "COMMAND_FAILED"
    | "COMMAND_TIMEOUT";
  message: string;
  retryable: boolean;
  policyDecision?: CommandPolicyDecision;
}

export interface SuggestionError {
  code:
    | "SUGGESTION_INVALID"
    | "SUGGESTION_BLOCKED"
    | "SUGGESTION_FAILED"
    | "SUGGESTION_UNAVAILABLE";
  message: string;
  retryable: boolean;
  policyDecision?: CommandPolicyDecision;
}

export interface CommandAuditEvent {
  command: string;
  family?: CommandFamily;
  subcommand?: string;
  startedAt: number;
  durationMs: number;
  exitCode: number;
  allowed: boolean;
}

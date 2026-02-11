import { AgentMessage, LLMProvider, ModelPreferences } from "@shared/coordination";
import {
  BrokerSuggestRequest,
  BrokerSuggestResponse,
  SuggestionSource,
} from "@shared/terminal";
import { evaluateCommandPolicy } from "../commands/policy";
import { createConfiguredProviders, createProvider } from "../agent/providers";

interface StreamingProvider extends LLMProvider {
  streamResponse(config: {
    systemPrompt: string;
    messages: AgentMessage[];
    tools: [];
    modelPreferences?: ModelPreferences;
  }): AsyncGenerator<{
    type: string;
    text?: string;
    error?: { message?: string };
  }>;
}

interface SuggestionCandidate {
  command: string;
  confidence?: number;
  rationale?: string;
  assumptions?: string[];
  warnings?: string[];
}

interface SuggestionPlan {
  query: string;
  suggestedCommand: string;
  source: SuggestionSource;
  confidence: number;
  rationale: string;
  assumptions: string[];
  warnings: string[];
}

export class CommandSuggestionError extends Error {
  code:
    | "SUGGESTION_INVALID"
    | "SUGGESTION_BLOCKED"
    | "SUGGESTION_FAILED"
    | "SUGGESTION_UNAVAILABLE";
  retryable: boolean;
  policyDecision?: ReturnType<typeof evaluateCommandPolicy>["decision"];

  constructor(
    code: CommandSuggestionError["code"],
    message: string,
    retryable: boolean,
    policyDecision?: ReturnType<typeof evaluateCommandPolicy>["decision"],
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.policyDecision = policyDecision;
  }
}

function clampConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeIntentText(query: string): string {
  return query
    .toLowerCase()
    .replace(/\blsit\b/g, "list")
    .replace(/\brunnig\b/g, "running")
    .replace(/\bnameapce\b/g, "namespace")
    .replace(/\bnamesapce\b/g, "namespace")
    .replace(/\bnmespace\b/g, "namespace")
    .replace(/\bdeplyoment\b/g, "deployment")
    .replace(/\bdeplyoments\b/g, "deployments")
    .replace(/\bdeployemnt\b/g, "deployment")
    .replace(/\bdeployemnts\b/g, "deployments")
    .replace(/\bservcies\b/g, "services")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonCandidate(raw: string): SuggestionCandidate | null {
  if (!raw.trim()) return null;

  const candidates: string[] = [];
  const codeBlock = raw.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]) {
    candidates.push(codeBlock[1].trim());
  }

  candidates.push(raw.trim());

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(raw.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as SuggestionCandidate;
      if (!parsed.command || typeof parsed.command !== "string") {
        continue;
      }
      return {
        command: parsed.command.trim(),
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        assumptions: Array.isArray(parsed.assumptions)
          ? parsed.assumptions.map(String)
          : [],
        warnings: Array.isArray(parsed.warnings)
          ? parsed.warnings.map(String)
          : [],
      };
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}

function extractNamespace(query: string, fallbackNamespace: string): string {
  const normalized = normalizeIntentText(query);
  if (
    normalized.includes("all namespaces") ||
    normalized.includes("across all namespaces") ||
    normalized.includes("all ns") ||
    normalized.includes("in the cluster") ||
    normalized.includes("across the cluster") ||
    normalized.includes("whole cluster")
  ) {
    return "all";
  }

  const inNamespace = query.match(/\bin\s+([a-z0-9-]+)\s+namespace\b/i);
  if (inNamespace?.[1]) {
    return inNamespace[1].toLowerCase();
  }

  const inPlain = query.match(/\b(?:in|ind)\s+([a-z0-9-]+)\b/i);
  if (inPlain?.[1]) {
    const candidate = inPlain[1].toLowerCase();
    if (!["the", "this", "that", "my", "our"].includes(candidate)) {
      return candidate;
    }
  }

  const namespaceNamed = query.match(/\bnamespace\s+([a-z0-9-]+)\b/i);
  if (namespaceNamed?.[1]) {
    return namespaceNamed[1].toLowerCase();
  }

  const forNamespace = query.match(/\bfor\s+([a-z0-9-]+)\b/i);
  if (forNamespace?.[1]) {
    return forNamespace[1].toLowerCase();
  }

  return fallbackNamespace;
}

function normalizeKubectlCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function extractNamespaceFromRecentContext(
  recentContext?: BrokerSuggestRequest["recentTerminalContext"],
): string | null {
  if (!recentContext?.length) return null;

  for (let i = recentContext.length - 1; i >= 0; i -= 1) {
    const entry = recentContext[i];
    if (entry.type !== "input") continue;

    const command = entry.content.replace(/^[>$]\s*/, "").trim();
    if (!command.startsWith("kubectl ")) continue;

    const shortFlag = command.match(/(?:^|\s)-n\s+([a-z0-9-]+)/i);
    if (shortFlag?.[1]) return shortFlag[1].toLowerCase();

    const longFlag = command.match(/(?:^|\s)--namespace(?:=|\s+)([a-z0-9-]+)/i);
    if (longFlag?.[1]) return longFlag[1].toLowerCase();
  }

  return null;
}

function formatRecentContextForPrompt(
  recentContext?: BrokerSuggestRequest["recentTerminalContext"],
): string {
  if (!recentContext?.length) return "none";

  return recentContext
    .slice(-4)
    .map((entry) => {
      const content = entry.content.replace(/\s+/g, " ").trim().slice(0, 600);
      return `${entry.type.toUpperCase()}: ${content}`;
    })
    .join("\n");
}

function hasNonRunningPodsIntent(normalizedQuery: string): boolean {
  const hasPods = normalizedQuery.includes("pod");
  const hasNonRunningPhrase =
    normalizedQuery.includes("non-running") ||
    normalizedQuery.includes("non running") ||
    normalizedQuery.includes("not running") ||
    normalizedQuery.includes("not runnig") ||
    normalizedQuery.includes("failing pod") ||
    normalizedQuery.includes("failed pod") ||
    normalizedQuery.includes("crashloop") ||
    normalizedQuery.includes("pending pod") ||
    normalizedQuery.includes("not healthy") ||
    /\bnot\s+runn\w*\b/.test(normalizedQuery);
  return hasPods && hasNonRunningPhrase;
}

function hasDeploymentsIntent(normalizedQuery: string): boolean {
  return normalizedQuery.includes("deployment");
}

function hasServicesIntent(normalizedQuery: string): boolean {
  return normalizedQuery.includes("service");
}

function hasNodesIntent(normalizedQuery: string): boolean {
  return normalizedQuery.includes("node") || normalizedQuery.includes("nodes");
}

function commandMatchesNonRunningPods(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    normalized.startsWith("kubectl get pods") &&
    normalized.includes("--field-selector=status.phase!=running")
  );
}

function hasPodsDeploymentsIntent(normalizedQuery: string): boolean {
  const hasPods = normalizedQuery.includes("pod");
  const hasDeployments =
    normalizedQuery.includes("deployment") || normalizedQuery.includes("deployments");
  return hasPods && hasDeployments;
}

function commandMatchesPodsDeployments(command: string): boolean {
  const normalized = normalizeKubectlCommand(command).toLowerCase();
  return (
    normalized.startsWith("kubectl get pods,deployments") ||
    normalized.startsWith("kubectl get deployment,pod")
  );
}

function shouldRouteToChatForDiagnosis(normalizedQuery: string): boolean {
  const diagnosticPhrases = [
    "what's wrong",
    "whats wrong",
    "what is wrong",
    "why is",
    "why are",
    "diagnose",
    "diagnosis",
    "root cause",
    "rca",
    "how to fix",
    "fix this",
  ];
  return diagnosticPhrases.some((phrase) => normalizedQuery.includes(phrase));
}

function isGenericInventoryCommand(command: string): boolean {
  const normalized = normalizeKubectlCommand(command).toLowerCase();
  const genericPrefixes = [
    "kubectl get pods",
    "kubectl get deployments",
    "kubectl get services",
    "kubectl get namespaces",
    "kubectl get nodes",
    "kubectl get pods,deployments",
    "kubectl get deployment,pod",
  ];
  return genericPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function buildHeuristicSuggestion(request: BrokerSuggestRequest): SuggestionPlan | null {
  const query = request.query.trim();
  const normalized = normalizeIntentText(query);
  const contextNamespace = extractNamespaceFromRecentContext(request.recentTerminalContext);
  const defaultNamespace =
    contextNamespace || request.namespace || request.workingNamespace || "default";
  const namespace = extractNamespace(query, defaultNamespace);
  const assumptions: string[] = [];

  if (shouldRouteToChatForDiagnosis(normalized)) {
    return null;
  }

  if (!normalized.includes(namespace) && namespace !== "all") {
    assumptions.push(`Using namespace '${namespace}'.`);
  }
  if (
    contextNamespace &&
    namespace === contextNamespace &&
    !normalized.includes(contextNamespace) &&
    !normalized.includes("namespace")
  ) {
    assumptions.push(`Inferred namespace '${contextNamespace}' from recent terminal command context.`);
  }

  if (hasPodsDeploymentsIntent(normalized)) {
    const acrossCluster =
      namespace === "all" ||
      normalized.includes("across all namespaces") ||
      normalized.includes("all namespaces") ||
      normalized.includes("in the cluster");

    return {
      query,
      source: "heuristic",
      suggestedCommand: acrossCluster
        ? "kubectl get pods,deployments -A"
        : `kubectl get pods,deployments -n ${namespace}`,
      confidence: 88,
      rationale: "Detected combined pods and deployments inventory intent.",
      assumptions,
      warnings: ["Heuristic fallback used."],
    };
  }

  if (
    (normalized.includes("namespace") && normalized.includes("access")) ||
    normalized.includes("which namespaces") ||
    normalized.includes("namespaces can i")
  ) {
    return {
      query,
      source: "heuristic",
      suggestedCommand: "kubectl get namespaces",
      confidence: 92,
      rationale: "Namespace discovery intent matched.",
      assumptions: [],
      warnings: ["Heuristic fallback used."],
    };
  }

  if (hasNonRunningPodsIntent(normalized)) {
    return {
      query,
      source: "heuristic",
      suggestedCommand:
        "kubectl get pods -A --field-selector=status.phase!=Running",
      confidence: 90,
      rationale: "Detected request for non-running pods across namespaces.",
      assumptions: [],
      warnings: ["Heuristic fallback used."],
    };
  }

  if (normalized.includes("event")) {
    const isWarningOnly = normalized.includes("warning");
    const isAllEvents =
      normalized.includes("all events") || normalized.includes("events all");
    return {
      query,
      source: "heuristic",
      suggestedCommand:
        namespace === "all"
          ? isWarningOnly && !isAllEvents
            ? "kubectl get events -A --field-selector type=Warning"
            : "kubectl get events -A"
          : isWarningOnly && !isAllEvents
            ? `kubectl get events -n ${namespace} --field-selector type=Warning`
            : `kubectl get events -n ${namespace}`,
      confidence: 86,
      rationale: isWarningOnly && !isAllEvents
        ? "Detected warning event lookup intent."
        : "Detected event listing intent.",
      assumptions,
      warnings: ["Heuristic fallback used."],
    };
  }

  if (hasDeploymentsIntent(normalized) && !hasPodsDeploymentsIntent(normalized)) {
    const acrossCluster =
      namespace === "all" ||
      normalized.includes("across all namespaces") ||
      normalized.includes("all namespaces") ||
      normalized.includes("in the cluster");
    return {
      query,
      source: "heuristic",
      suggestedCommand: acrossCluster
        ? "kubectl get deployments -A"
        : `kubectl get deployments -n ${namespace}`,
      confidence: 85,
      rationale: "Detected deployment listing intent.",
      assumptions,
      warnings: ["Heuristic fallback used."],
    };
  }

  if (hasServicesIntent(normalized)) {
    const acrossCluster =
      namespace === "all" ||
      normalized.includes("across all namespaces") ||
      normalized.includes("all namespaces") ||
      normalized.includes("in the cluster");
    return {
      query,
      source: "heuristic",
      suggestedCommand: acrossCluster
        ? "kubectl get services -A"
        : `kubectl get services -n ${namespace}`,
      confidence: 82,
      rationale: "Detected service listing intent.",
      assumptions,
      warnings: ["Heuristic fallback used."],
    };
  }

  if (hasNodesIntent(normalized)) {
    return {
      query,
      source: "heuristic",
      suggestedCommand: "kubectl get nodes",
      confidence: 80,
      rationale: "Detected node inventory intent.",
      assumptions: [],
      warnings: ["Heuristic fallback used."],
    };
  }

  if (normalized.includes("log")) {
    const podMatch =
      normalized.match(/\bpod\s+([a-z0-9][a-z0-9-]*)\b/) ||
      normalized.match(/\blogs?\s+for\s+([a-z0-9][a-z0-9-]*)\b/);
    if (podMatch?.[1]) {
      const logNamespace = namespace === "all" ? "default" : namespace;
      const logAssumptions = [...assumptions];
      if (namespace === "all") {
        logAssumptions.push(
          "Defaulted to namespace 'default' for pod logs. Specify namespace for exact pod lookup.",
        );
      }
      return {
        query,
        source: "heuristic",
        suggestedCommand: `kubectl logs ${podMatch[1]} -n ${logNamespace} --tail 100`,
        confidence: 78,
        rationale: "Detected pod logs lookup intent.",
        assumptions: logAssumptions,
        warnings: ["Heuristic fallback used."],
      };
    }
  }

  if (normalized.includes("pod")) {
    const useContextNamespace =
      contextNamespace &&
      (normalized.includes("here") ||
        normalized.includes("current namespace") ||
        normalized.includes("in this namespace"));

    return {
      query,
      source: "heuristic",
      suggestedCommand:
        namespace === "all"
          ? "kubectl get pods -A"
          : `kubectl get pods -n ${useContextNamespace ? contextNamespace : namespace}`,
      confidence: 80,
      rationale: "Defaulted to pod listing for natural language request.",
      assumptions,
      warnings: ["Heuristic fallback used."],
    };
  }

  return {
    query,
    source: "heuristic",
    suggestedCommand:
      namespace === "all" ? "kubectl get pods -A" : `kubectl get pods -n ${namespace}`,
    confidence: 60,
    rationale: "Could not infer exact intent, defaulting to safe pod listing.",
    assumptions,
    warnings: ["Heuristic fallback used.", "Intent was ambiguous."],
  };
}

function toStreamingProvider(provider: LLMProvider): StreamingProvider | null {
  if ("streamResponse" in provider && typeof provider.streamResponse === "function") {
    return provider as StreamingProvider;
  }
  return null;
}

function chooseProvider(
  request: BrokerSuggestRequest,
): { provider: StreamingProvider | null; warning?: string } {
  if (request.modelPreferences?.providerId && request.modelPreferences?.apiKey) {
    try {
      const provider = createProvider(
        request.modelPreferences.providerId,
        request.modelPreferences.apiKey,
      );
      return { provider: toStreamingProvider(provider) };
    } catch (error) {
      return {
        provider: null,
        warning:
          error instanceof Error
            ? `Agentic suggestion unavailable: ${error.message}`
            : "Agentic suggestion unavailable",
      };
    }
  }

  const providers = createConfiguredProviders();
  if (providers.size === 0) {
    return {
      provider: null,
      warning: "No LLM provider configured, using heuristic fallback.",
    };
  }

  if (request.modelPreferences?.providerId) {
    const selected = providers.get(request.modelPreferences.providerId);
    if (selected) {
      return { provider: toStreamingProvider(selected) };
    }
  }

  const prioritized =
    providers.get("claude") || providers.get("openai") || providers.get("gemini");
  if (prioritized) {
    return { provider: toStreamingProvider(prioritized) };
  }

  const first = Array.from(providers.values())[0];
  return { provider: first ? toStreamingProvider(first) : null };
}

async function attemptAgenticSuggestion(
  request: BrokerSuggestRequest,
): Promise<{ candidate: SuggestionCandidate | null; warning?: string }> {
  const { provider, warning } = chooseProvider(request);
  if (!provider) {
    return { candidate: null, warning: warning || "No provider available." };
  }

  const inferredNamespace =
    extractNamespaceFromRecentContext(request.recentTerminalContext) ||
    request.namespace ||
    request.workingNamespace ||
    "default";

  const userPrompt = [
    "Convert this natural language Kubernetes request into ONE safe kubectl read-only command.",
    "Return STRICT JSON only with schema:",
    '{"command":"string","confidence":0,"rationale":"string","assumptions":["string"],"warnings":["string"]}',
    "Rules:",
    "- command must start with 'kubectl'",
    "- allowed subcommands: get, describe, logs, top, events, api-resources, cluster-info, version, config, explain",
    "- never include shell operators (; | && || > < ` $() ${})",
    "- prefer explicit namespace when relevant",
    "",
    `Default namespace: ${inferredNamespace}`,
    `Cluster context: ${request.clusterContext || request.context || "current"}`,
    "Recent terminal context (last commands/results):",
    formatRecentContextForPrompt(request.recentTerminalContext),
    `User query: ${request.query}`,
  ].join("\n");

  let raw = "";
  for await (const chunk of provider.streamResponse({
    systemPrompt:
      "You generate safe kubectl command suggestions. Return strict JSON only.",
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    tools: [],
    modelPreferences: {
      providerId: request.modelPreferences?.providerId,
      model: request.modelPreferences?.model,
      temperature: 0,
      maxTokens: 500,
    },
  })) {
    if (chunk.type === "text" && chunk.text) {
      raw += chunk.text;
    }
    if (chunk.type === "error") {
      return {
        candidate: null,
        warning: chunk.error?.message || "Agentic suggestion failed.",
      };
    }
  }

  const parsed = extractJsonCandidate(raw);
  if (!parsed) {
    return {
      candidate: null,
      warning: "Agentic output was not parseable JSON.",
    };
  }

  parsed.command = normalizeKubectlCommand(parsed.command);
  if (!parsed.command.startsWith("kubectl ")) {
    return {
      candidate: null,
      warning: "Agentic suggestion was rejected because it was not a kubectl command.",
    };
  }

  return { candidate: parsed };
}

export async function suggestCommand(
  request: BrokerSuggestRequest,
): Promise<BrokerSuggestResponse> {
  const query = request.query?.trim();
  if (!query) {
    throw new CommandSuggestionError(
      "SUGGESTION_INVALID",
      "Natural language query is required.",
      false,
    );
  }

  const warnings: string[] = [];
  let plan: SuggestionPlan | null = null;

  const agenticAttempt = await attemptAgenticSuggestion(request);
  if (agenticAttempt.warning) {
    warnings.push(agenticAttempt.warning);
  }

  if (agenticAttempt.candidate) {
    const agenticDecision = evaluateCommandPolicy(agenticAttempt.candidate.command);
    if (agenticDecision.decision.allowed && agenticDecision.decision.family === "kubectl") {
      if (hasNonRunningPodsIntent(query.toLowerCase()) &&
        !commandMatchesNonRunningPods(agenticAttempt.candidate.command)) {
        warnings.push(
          "Agentic suggestion did not match non-running pod intent; using deterministic fallback.",
        );
      } else if (
        hasPodsDeploymentsIntent(query.toLowerCase()) &&
        !commandMatchesPodsDeployments(agenticAttempt.candidate.command)
      ) {
        warnings.push(
          "Agentic suggestion did not include both pods and deployments; using deterministic fallback.",
        );
      } else if (
        shouldRouteToChatForDiagnosis(query.toLowerCase()) &&
        isGenericInventoryCommand(agenticAttempt.candidate.command)
      ) {
        warnings.push(
          "Diagnostic intent detected; generic inventory command is not sufficient.",
        );
      } else {
        plan = {
          query,
          suggestedCommand: agenticAttempt.candidate.command,
          source: "agentic",
          confidence: clampConfidence(agenticAttempt.candidate.confidence, 85),
          rationale:
            agenticAttempt.candidate.rationale ||
            "Generated from natural language intent using configured LLM.",
          assumptions: agenticAttempt.candidate.assumptions || [],
          warnings: [...warnings, ...(agenticAttempt.candidate.warnings || [])],
        };
      }
    } else {
      warnings.push(
        `Agentic suggestion blocked by policy: ${agenticDecision.decision.reason || "blocked"}`,
      );
    }
  }

  if (!plan) {
    const heuristic = buildHeuristicSuggestion(request);
    if (!heuristic) {
      throw new CommandSuggestionError(
        "SUGGESTION_UNAVAILABLE",
        "This looks like a diagnosis question. Please switch to the Chat panel for RCA guidance.",
        false,
      );
    }
    plan = {
      ...heuristic,
      warnings: [...warnings, ...heuristic.warnings],
    };
  }

  const finalDecision = evaluateCommandPolicy(plan.suggestedCommand);
  if (!finalDecision.decision.allowed) {
    throw new CommandSuggestionError(
      "SUGGESTION_BLOCKED",
      finalDecision.decision.reason || "Suggested command blocked by policy.",
      false,
      finalDecision.decision,
    );
  }

  return {
    query: plan.query,
    suggestedCommand: plan.suggestedCommand,
    source: plan.source,
    confidence: plan.confidence,
    rationale: plan.rationale,
    assumptions: plan.assumptions,
    warnings: plan.warnings,
    policyDecision: finalDecision.decision,
    generatedAt: Date.now(),
  };
}

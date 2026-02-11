import { useState, useRef, useEffect } from "react";
import { Send, Copy, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTerminalSession } from "@/hooks/useTerminalSession";
import { useCommandSuggestion } from "@/hooks/useCommandSuggestion";
import { useWorkspaceScope } from "@/lib/workspaceScope";

type TerminalMode = "command" | "natural_language";

interface KubectlTerminalProps {
  context?: string;
  namespace?: string;
}

const CHAT_HANDOFF_STORAGE_KEY = "kubeagentix_chat_handoff";

const KNOWN_COMMAND_PREFIXES = new Set([
  "kubectl",
  "k",
  "docker",
  "git",
  "sh",
  "bash",
  "zsh",
  "helm",
  "npm",
  "pnpm",
  "node",
  "ls",
  "cat",
  "grep",
  "awk",
  "sed",
  "tail",
  "head",
  "pwd",
  "cd",
]);

function looksLikeNaturalLanguageQuery(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0].toLowerCase();
  if (KNOWN_COMMAND_PREFIXES.has(firstToken)) return false;
  if (firstToken.startsWith("./") || firstToken.startsWith("/") || firstToken.startsWith("~")) {
    return false;
  }
  if (tokens.some((token) => token.startsWith("-"))) return false;
  if (/[|&;<>()`$]/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  const hasQuestionMark = lower.includes("?");
  const keywordList = [
    "show",
    "list",
    "which",
    "what",
    "why",
    "how",
    "pods",
    "deployments",
    "services",
    "events",
    "logs",
    "namespace",
    "namespaces",
    "across",
  ];
  const hasNlKeyword = keywordList.some((keyword) => lower.includes(keyword));
  return hasQuestionMark || (tokens.length >= 4 && hasNlKeyword);
}

function buildRecentTerminalContext(
  lines: Array<{ type: "input" | "output" | "error"; content: string }>,
) {
  return lines.slice(-4).map((line) => ({
    type: line.type,
    content: line.content.slice(0, 1200),
  }));
}

export function KubectlTerminal({
  context = "prod-us-west",
  namespace = "all",
}: KubectlTerminalProps) {
  const scope = useWorkspaceScope();
  const navigate = useNavigate();
  const { lines, history, isExecuting, executeCommand } = useTerminalSession(context, {
    namespace,
    scopeId: scope.scopeId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    integrationProfileId: scope.integrationProfileId,
  });
  const {
    suggestion,
    loading: isSuggesting,
    error: suggestionError,
    errorCode: suggestionErrorCode,
    suggestCommand,
    clearSuggestion,
  } = useCommandSuggestion();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<TerminalMode>("command");
  const [suggestedCommandDraft, setSuggestedCommandDraft] = useState("");
  const [showSuggestionDetails, setShowSuggestionDetails] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [commandModeHint, setCommandModeHint] = useState<string | null>(null);
  const [lastSubmittedNlQuery, setLastSubmittedNlQuery] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    if (suggestion?.suggestedCommand) {
      setSuggestedCommandDraft(suggestion.suggestedCommand);
      setShowSuggestionDetails(false);
    }
  }, [suggestion?.suggestedCommand]);

  const runCurrentInput = async () => {
    if (!input.trim() || isExecuting || isSuggesting) return;
    const current = input;
    const recentTerminalContext = buildRecentTerminalContext(lines);
    setHistoryIndex(-1);

    if (mode === "command") {
      if (looksLikeNaturalLanguageQuery(current)) {
        setMode("natural_language");
        setCommandModeHint("Detected natural-language input. Switched to Natural Language mode and generated a suggestion.");
        setLastSubmittedNlQuery(current);
        setInput("");
        await suggestCommand({
          query: current,
          context,
          clusterContext: context,
          namespace,
          scopeId: scope.scopeId,
          workingNamespace: namespace,
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          integrationProfileId: scope.integrationProfileId,
          recentTerminalContext,
        });
        return;
      }
      setCommandModeHint(null);
      setInput("");
      await executeCommand(current);
      return;
    }

    setCommandModeHint(null);
    setLastSubmittedNlQuery(current);
    await suggestCommand({
      query: current,
      context,
      clusterContext: context,
      namespace,
      scopeId: scope.scopeId,
      workingNamespace: namespace,
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      integrationProfileId: scope.integrationProfileId,
      recentTerminalContext,
    });
  };

  const executeSuggestedCommand = async () => {
    if (
      !suggestion ||
      !suggestion.policyDecision.allowed ||
      !suggestedCommandDraft.trim() ||
      isExecuting
    ) {
      return;
    }
    await executeCommand(suggestedCommandDraft);
    clearSuggestion();
    setSuggestedCommandDraft("");
    setShowSuggestionDetails(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runCurrentInput();
    } else if (mode === "command" && e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(newIndex);
      if (newIndex >= 0) setInput(history[history.length - 1 - newIndex]);
    } else if (mode === "command" && e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      if (newIndex >= 0) setInput(history[history.length - 1 - newIndex]);
      else setInput("");
    }
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full min-h-[24rem]">
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-2 bg-zinc-900/60">
        <span className="text-[11px] text-zinc-500 ml-2">
          {mode === "command"
            ? "Run kubectl commands directly"
            : "Describe intent, review command, then execute"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 font-mono text-sm">
        {lines.map((line) => (
          <div key={line.id} className="group max-w-full min-w-0">
            {line.type === "input" ? (
              <div className="text-orange-400 whitespace-pre-wrap break-words">
                {line.content}
              </div>
            ) : (
              <div
                className={`rounded-md border p-3 mt-2 max-w-full min-w-0 ${
                  line.type === "error"
                    ? "border-red-900/70 bg-red-950/20"
                    : "border-zinc-800 bg-zinc-900/70"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[11px] uppercase tracking-wide ${
                      line.type === "error" ? "text-red-400" : "text-green-400"
                    }`}
                  >
                    {line.type === "error" ? "stderr" : "stdout"}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(line.content);
                      setCopiedId(line.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition text-zinc-400 hover:text-zinc-200"
                    aria-label="Copy terminal output"
                  >
                    {copiedId === line.id ? (
                      <Check className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <pre
                  className={`text-xs sm:text-sm leading-relaxed overflow-x-auto whitespace-pre max-w-full ${
                    line.type === "error" ? "text-red-300" : "text-green-300"
                  }`}
                >
                  {line.content}
                </pre>
              </div>
            )}
          </div>
        ))}
        {(isExecuting || isSuggesting) && (
          <div className="text-zinc-400 text-xs pt-1">
            {isExecuting
              ? "Running command..."
              : "Translating natural language to command..."}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {mode === "natural_language" && (suggestion || suggestionError) && (
        <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/95">
          {suggestion && (
            <div className="rounded-md border border-zinc-700 bg-zinc-900/70 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-zinc-300">
                  Suggested command
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`px-2 py-0.5 rounded ${
                      suggestion.source === "agentic"
                        ? "bg-sky-500/30 text-sky-200"
                        : "bg-zinc-700 text-zinc-200"
                    }`}
                  >
                    {suggestion.source}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded ${
                      suggestion.policyDecision.allowed
                        ? "bg-emerald-500/30 text-emerald-200"
                        : "bg-red-500/30 text-red-200"
                    }`}
                  >
                    {suggestion.policyDecision.allowed ? "allowed" : "blocked"}
                  </span>
                </div>
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
                <input
                  type="text"
                  value={suggestedCommandDraft}
                  onChange={(e) => setSuggestedCommandDraft(e.target.value)}
                  className="w-full bg-transparent text-green-300 text-xs sm:text-sm font-mono outline-none"
                />
              </div>

              {!suggestion.policyDecision.allowed && (
                <div className="text-xs text-red-300">
                  Blocked by policy: {suggestion.policyDecision.reason || "unknown reason"}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={executeSuggestedCommand}
                  className="bg-orange-700 hover:bg-orange-600 text-white"
                  disabled={
                    isExecuting ||
                    !suggestion.policyDecision.allowed ||
                    !suggestedCommandDraft.trim()
                  }
                >
                  Execute command
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-zinc-300 hover:bg-zinc-800"
                  onClick={() => setShowSuggestionDetails((prev) => !prev)}
                >
                  {showSuggestionDetails ? "Hide details" : "Show details"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-zinc-300 hover:bg-zinc-800"
                  onClick={clearSuggestion}
                >
                  Clear suggestion
                </Button>
              </div>

              {showSuggestionDetails && (
                <div className="space-y-2 pt-1">
                  <div className="text-xs text-zinc-300 leading-relaxed">
                    {suggestion.rationale}
                  </div>

                  {suggestion.assumptions.length > 0 && (
                    <div>
                      <div className="text-[11px] text-zinc-400 mb-1">Assumptions</div>
                      <ul className="text-xs text-zinc-300 list-disc pl-4 space-y-1">
                        {suggestion.assumptions.map((assumption, idx) => (
                          <li key={`${assumption}-${idx}`}>{assumption}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {suggestion.warnings.length > 0 && (
                    <div>
                      <div className="text-[11px] text-zinc-400 mb-1">Warnings</div>
                      <ul className="text-xs text-amber-300 list-disc pl-4 space-y-1">
                        {suggestion.warnings.map((warning, idx) => (
                          <li key={`${warning}-${idx}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {suggestionError && (
            <div
              className={`rounded-md border p-3 mt-3 text-xs ${
                suggestionErrorCode === "SUGGESTION_UNAVAILABLE"
                  ? "border-sky-900/70 bg-sky-950/20 text-sky-200"
                  : "border-red-900/70 bg-red-950/20 text-red-300"
              }`}
            >
              <div>{suggestionError}</div>
              {suggestionErrorCode === "SUGGESTION_UNAVAILABLE" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-sky-300/90">
                    Tip: Open the Chat tab for incident diagnosis, then return here to run commands.
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-sky-200 hover:bg-sky-500/20"
                    onClick={() => {
                      const handoffPayload = {
                        source: "terminal",
                        query: input.trim() || lastSubmittedNlQuery || suggestion?.query || "",
                        cluster: context,
                        namespace,
                        recentTerminalContext: buildRecentTerminalContext(lines).slice(-2),
                        createdAt: Date.now(),
                      };
                      sessionStorage.setItem(
                        CHAT_HANDOFF_STORAGE_KEY,
                        JSON.stringify(handoffPayload),
                      );
                      clearSuggestion();
                      navigate("/chat?handoff=terminal");
                    }}
                  >
                    Go to Chat
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {commandModeHint && (
        <div className="border-t border-zinc-800 px-4 py-2 bg-sky-500/10 text-xs text-sky-200">
          {commandModeHint}
        </div>
      )}

      <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-2">
        <span className="text-orange-400 font-mono">
          {mode === "command" ? "$" : ">"}
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "command"
              ? "Enter kubectl command..."
              : "Describe what you want to inspect..."
          }
          className="flex-1 bg-transparent text-white font-mono outline-none"
          autoFocus
          disabled={isExecuting || isSuggesting}
        />
        <Button
          size="sm"
          onClick={runCurrentInput}
          className="bg-sky-400/60 hover:bg-sky-400/70"
          disabled={isExecuting || isSuggesting || !input.trim()}
          aria-label={mode === "command" ? "Run command" : "Suggest command"}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      <div className="border-t border-zinc-800 px-4 py-2 flex items-center gap-2 bg-zinc-950/60">
        <label htmlFor="terminal-mode" className="text-xs text-zinc-400">
          Mode
        </label>
        <select
          id="terminal-mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as TerminalMode);
            setCommandModeHint(null);
          }}
          className="h-7 min-w-[9.5rem] rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs px-2 focus:outline-none focus:ring-1 focus:ring-orange-500"
        >
          <option value="command">Command</option>
          <option value="natural_language">Natural Language</option>
        </select>
      </div>
    </div>
  );
}

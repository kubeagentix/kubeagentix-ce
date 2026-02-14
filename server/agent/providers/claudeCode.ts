import { spawn, spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  AgentError,
  AgentMessage,
  AgentResponseChunk,
  LLMProvider,
  ModelPreferences,
  ToolDefinition,
} from "@shared/coordination";

interface ClaudeCodeRequestConfig {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  modelPreferences?: ModelPreferences;
}

interface ParsedStreamLine {
  text?: string;
  error?: string;
  done?: boolean;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeAuthToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const prefixed = trimmed.match(/^authToken\s*:\s*(.+)$/i);
  const unwrapped = (prefixed?.[1] || trimmed)
    .trim()
    .replace(/^["']+|["']+$/g, "");

  return unwrapped || undefined;
}

function isAnthropicApiKey(value: string | undefined): boolean {
  return typeof value === "string" && /^sk-ant-/i.test(value.trim());
}

export class ClaudeCodeProvider implements LLMProvider {
  private static executionQueue: Promise<void> = Promise.resolve();

  id = "claude_code";
  name = "Claude Code (Subscription)";

  supportedModels = [
    "sonnet",
    "opus",
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ];
  defaultModel = "sonnet";
  contextWindowSize = 200000;
  supportsStreaming = true;
  supportsToolUse = false;
  supportsVision = false;
  supportsExtendedThinking = false;

  apiKeyRequired = false;
  priority = 0;

  private readonly cliPath: string;
  private readonly timeoutMs: number;
  private readonly settingSources: string;
  private readonly authTokenOverride?: string;

  constructor(cliPath?: string, authToken?: string) {
    this.cliPath = cliPath || process.env.CLAUDE_CODE_CLI_PATH || "claude";
    this.timeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS || 45000);
    this.settingSources =
      process.env.CLAUDE_CODE_SETTING_SOURCES?.trim() || "project,local";
    this.authTokenOverride = normalizeAuthToken(authToken);
    this.assertCliAvailable();
  }

  async *streamResponse(
    config: ClaudeCodeRequestConfig,
  ): AsyncGenerator<AgentResponseChunk> {
    const releaseLock = await this.acquireExecutionLock();
    try {
      const env = this.buildEnv();
      this.recoverCorruptConfigIfNeeded(env);

      const model = config.modelPreferences?.model || this.defaultModel;
      const prompt = this.buildPrompt(config.systemPrompt, config.messages);

      const args = this.buildArgs({
        model,
        systemPrompt: config.systemPrompt,
        outputFormat: "stream-json",
        verbose: true,
      });

      const child = spawn(this.cliPath, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.end(prompt);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let emittedText = false;
    let timedOut = false;
    let processError: string | undefined;
    let cliError: string | undefined;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
        }
      }, 2000).unref();
    }, this.timeoutMs);

    const textQueue: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const parsed = this.parseStreamLine(line);
        if (parsed.text) {
          textQueue.push(parsed.text);
        }
        if (parsed.error && !cliError) {
          cliError = parsed.error;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      processError = error.message;
    });

    while (child.exitCode === null || textQueue.length > 0) {
      while (textQueue.length > 0) {
        emittedText = true;
        yield {
          type: "text",
          chunkId: uuidv4(),
          timestamp: Date.now(),
          text: textQueue.shift()!,
          isDone: false,
        };
      }
      if (processError || timedOut) {
        break;
      }
      await this.delay(20);
    }

    clearTimeout(timeout);

    const trailing = this.parseStreamLine(stdoutBuffer.trim());
    if (trailing.text) {
      emittedText = true;
      yield {
        type: "text",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        text: trailing.text,
        isDone: false,
      };
    }
    if (trailing.error && !cliError) {
      cliError = trailing.error;
    }

    const exitCode = child.exitCode ?? 1;

    if (processError) {
      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: "COMMAND_FAILED",
          message: this.normalizeErrorMessage(processError),
          retryable: false,
        },
      };
      return;
    }

    if (timedOut) {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: "TIMEOUT",
          message: `Claude Code request timed out after ${this.timeoutMs}ms`,
          retryable: true,
        },
      };
      return;
    }

    if (cliError) {
      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: "AUTH_REQUIRED",
          message: this.normalizeErrorMessage(cliError),
          retryable: false,
        },
      };
      return;
    }

    if (exitCode !== 0) {
      const message = (stderrBuffer || stdoutBuffer).trim() || undefined;
      yield {
        type: "error",
        chunkId: uuidv4(),
        timestamp: Date.now(),
        error: {
          code: "COMMAND_FAILED",
          message: this.normalizeErrorMessage(
            message || `Claude Code exited with code ${exitCode}`,
          ),
          retryable: false,
        },
      };
      return;
    }

    yield {
      type: "text",
      chunkId: uuidv4(),
      timestamp: Date.now(),
      text: emittedText ? "" : "No response from Claude Code.",
      isDone: true,
    };
    } finally {
      releaseLock();
    }
  }

  async *continueWithToolResults(
    config: ClaudeCodeRequestConfig,
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
      isError?: boolean;
    }>,
  ): AsyncGenerator<AgentResponseChunk> {
    const toolResultSummary = toolResults
      .map(
        (tr) =>
          `Tool ${tr.toolName} (${tr.toolCallId}) => ${JSON.stringify(tr.result)}`,
      )
      .join("\n");

    const continuationMessages: AgentMessage[] = [
      ...config.messages,
      {
        role: "assistant",
        content: `Tool results were returned:\n${toolResultSummary}`,
      },
    ];

    yield* this.streamResponse({
      ...config,
      messages: continuationMessages,
    });
  }

  async testConnection(): Promise<boolean> {
    const releaseLock = await this.acquireExecutionLock();
    try {
      const env = this.buildEnv();
      this.recoverCorruptConfigIfNeeded(env);

      const args = this.buildArgs({
        model: this.defaultModel,
        systemPrompt: "You are a helpful assistant.",
        outputFormat: "json",
        verbose: false,
      });
      const result = spawnSync(
        this.cliPath,
        args,
        {
          env,
          input: "Say OK and nothing else.",
          encoding: "utf8",
          timeout: this.timeoutMs,
        },
      );

      if (result.error || result.status !== 0) {
        return false;
      }

      const parsed = this.tryParseJson(result.stdout?.trim());
      if (parsed && parsed.is_error === true) {
        return false;
      }

      return true;
    } catch {
      return false;
    } finally {
      releaseLock();
    }
  }

  private assertCliAvailable(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    const shouldSkipCheck = parseBoolean(
      process.env.CLAUDE_CODE_SKIP_STARTUP_CHECK,
      false,
    );
    if (shouldSkipCheck) {
      return;
    }

    const env = this.buildEnv();
    this.recoverCorruptConfigIfNeeded(env);
    const result = spawnSync(this.cliPath, ["--version"], {
      env,
      encoding: "utf8",
      timeout: 5000,
    });

    if (result.error || result.status !== 0) {
      throw new AgentError(
        "CLAUDE_CODE_UNAVAILABLE",
        `Claude Code CLI not available at "${this.cliPath}". Install Claude Code and run "claude" once to authenticate.`,
        false,
      );
    }
  }

  private buildPrompt(systemPrompt: string, messages: AgentMessage[]): string {
    const messageTranscript = messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");

    return `${systemPrompt}\n\n${messageTranscript}`.trim();
  }

  private async acquireExecutionLock(): Promise<() => void> {
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = ClaudeCodeProvider.executionQueue;
    ClaudeCodeProvider.executionQueue = previous.then(() => lock, () => lock);
    await previous;
    return release;
  }

  private recoverCorruptConfigIfNeeded(env: NodeJS.ProcessEnv): void {
    const configPath = this.resolveConfigPath(env);
    if (!configPath) {
      return;
    }

    if (!existsSync(configPath)) {
      return;
    }

    try {
      const raw = readFileSync(configPath, "utf8");
      JSON.parse(raw);
      return;
    } catch {
      // Attempt backup recovery below.
    }

    const backups = this.findBackupCandidates(path.dirname(configPath));
    for (const backupName of backups) {
      const backupPath = path.join(path.dirname(configPath), backupName);
      try {
        const backupRaw = readFileSync(backupPath, "utf8");
        JSON.parse(backupRaw);
        copyFileSync(backupPath, configPath);
        return;
      } catch {
        // Continue scanning backups.
      }
    }
  }

  private findBackupCandidates(configDir: string): string[] {
    const candidates = readdirSync(configDir).filter(
      (name) =>
        name === ".claude.json.backup" ||
        name.startsWith(".claude.json.backup."),
    );

    return candidates.sort((a, b) => {
      const getTimestamp = (name: string): number => {
        if (name === ".claude.json.backup") return 0;
        return Number(name.split(".").pop() || "0");
      };
      const aTs = getTimestamp(a);
      const bTs = getTimestamp(b);
      return bTs - aTs;
    });
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const overrideToken = normalizeAuthToken(this.authTokenOverride);
    const envClaudeCodeOAuthToken = normalizeAuthToken(env.CLAUDE_CODE_OAUTH_TOKEN);
    const envClaudeCodeToken = normalizeAuthToken(env.CLAUDE_CODE_AUTH_TOKEN);
    const envAnthropicToken = normalizeAuthToken(env.ANTHROPIC_AUTH_TOKEN);
    const envAnthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;

    if (overrideToken) {
      // Claude Code subscription tokens should be passed via CLAUDE_CODE_OAUTH_TOKEN.
      // Keep CLAUDE_CODE_AUTH_TOKEN as legacy alias for backward compatibility.
      if (isAnthropicApiKey(overrideToken)) {
        env.ANTHROPIC_API_KEY = overrideToken;
      } else {
        env.CLAUDE_CODE_OAUTH_TOKEN = overrideToken;
        env.CLAUDE_CODE_AUTH_TOKEN = overrideToken;
      }
    } else {
      if (envClaudeCodeOAuthToken) {
        env.CLAUDE_CODE_OAUTH_TOKEN = envClaudeCodeOAuthToken;
      }
      if (envClaudeCodeToken) {
        env.CLAUDE_CODE_AUTH_TOKEN = envClaudeCodeToken;
      }
      if (envAnthropicToken) {
        env.ANTHROPIC_AUTH_TOKEN = envAnthropicToken;
      }
      if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
        if (env.CLAUDE_CODE_AUTH_TOKEN && !isAnthropicApiKey(env.CLAUDE_CODE_AUTH_TOKEN)) {
          env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_AUTH_TOKEN;
        } else if (
          env.ANTHROPIC_AUTH_TOKEN &&
          !isAnthropicApiKey(env.ANTHROPIC_AUTH_TOKEN)
        ) {
          env.CLAUDE_CODE_OAUTH_TOKEN = env.ANTHROPIC_AUTH_TOKEN;
        }
      }
      if (
        !env.ANTHROPIC_API_KEY &&
        envClaudeCodeToken &&
        isAnthropicApiKey(envClaudeCodeToken)
      ) {
        env.ANTHROPIC_API_KEY = envClaudeCodeToken;
      }
      if (
        !env.ANTHROPIC_API_KEY &&
        envAnthropicToken &&
        isAnthropicApiKey(envAnthropicToken)
      ) {
        env.ANTHROPIC_API_KEY = envAnthropicToken;
      }
    }

    // Avoid passing ANTHROPIC_AUTH_TOKEN to Claude Code CLI when OAuth token is provided,
    // which can force an unsupported auth path.
    if (env.CLAUDE_CODE_OAUTH_TOKEN) {
      delete env.ANTHROPIC_AUTH_TOKEN;
    }

    // Ensure at least one valid auth signal is present if we were given a usable token.
    if (!env.ANTHROPIC_API_KEY && !env.CLAUDE_CODE_OAUTH_TOKEN && overrideToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = overrideToken;
    }

    if (this.shouldUseIsolatedConfig(env)) {
      this.ensureIsolatedConfigDir(env);
    }

    return env;
  }

  private shouldUseIsolatedConfig(env: NodeJS.ProcessEnv): boolean {
    if (parseBoolean(env.CLAUDE_CODE_ISOLATE_CONFIG, false)) {
      return true;
    }
    return !!(
      this.authTokenOverride ||
      env.CLAUDE_CODE_OAUTH_TOKEN ||
      env.CLAUDE_CODE_AUTH_TOKEN ||
      env.ANTHROPIC_AUTH_TOKEN
    );
  }

  private ensureIsolatedConfigDir(env: NodeJS.ProcessEnv): void {
    const dir =
      env.CLAUDE_CODE_CONFIG_DIR?.trim() ||
      path.join(env.TMPDIR || "/tmp", "kubeagentix-claude-code");
    mkdirSync(dir, { recursive: true });
    env.CLAUDE_CONFIG_DIR = dir;

    const configPath = path.join(dir, ".claude.json");
    if (!existsSync(configPath)) {
      writeFileSync(configPath, "{}\n", "utf8");
      return;
    }

    try {
      JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      try {
        renameSync(configPath, path.join(dir, `.claude.json.corrupted.${Date.now()}`));
      } catch {
        // Best effort rotate; overwrite below if move fails.
      }
      writeFileSync(configPath, "{}\n", "utf8");
    }
  }

  private resolveConfigPath(env: NodeJS.ProcessEnv): string | null {
    const configDir = env.CLAUDE_CONFIG_DIR?.trim();
    if (configDir) {
      return path.join(configDir, ".claude.json");
    }
    const homeDir = env.HOME || process.env.HOME;
    if (!homeDir) {
      return null;
    }
    return path.join(homeDir, ".claude.json");
  }

  private buildArgs(options: {
    model: string;
    systemPrompt: string;
    outputFormat: "stream-json" | "json";
    verbose: boolean;
  }): string[] {
    const args = [
      "--print",
      "--output-format",
      options.outputFormat,
      "--input-format",
      "text",
      "--tools",
      "",
      "--model",
      options.model,
      "--system-prompt",
      options.systemPrompt,
      "--no-session-persistence",
    ];

    if (options.outputFormat === "stream-json" && options.verbose) {
      args.splice(3, 0, "--verbose");
    }

    if (this.settingSources) {
      args.push("--setting-sources", this.settingSources);
    }

    return args;
  }

  private parseStreamLine(line: string): ParsedStreamLine {
    if (!line) {
      return {};
    }

    const parsed = this.tryParseJson(line);
    if (!parsed) {
      return {};
    }

    const error = this.extractStreamError(parsed);
    if (error) {
      return { error, done: true };
    }

    return {
      text: this.extractText(parsed),
      done: parsed.type === "result",
    };
  }

  private tryParseJson(line: string): Record<string, any> | null {
    try {
      return JSON.parse(line) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private extractText(payload: Record<string, any>): string | undefined {
    const direct =
      payload.text ||
      payload.output_text ||
      payload.delta?.text ||
      payload.content?.text;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    const messageContent = payload.message?.content;
    if (Array.isArray(messageContent)) {
      const chunks = messageContent
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter(Boolean);
      if (chunks.length > 0) {
        return chunks.join("");
      }
    }

    return undefined;
  }

  private extractStreamError(payload: Record<string, any>): string | undefined {
    if (payload.type === "result" && payload.is_error === true) {
      const result =
        typeof payload.result === "string" ? payload.result : undefined;
      const errorMessage =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message;
      return result || errorMessage || "Claude Code request failed.";
    }

    if (payload.type === "error") {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : payload.error?.message;
      if (message) {
        return message;
      }
    }

    return undefined;
  }

  private normalizeErrorMessage(message: string): string {
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();

    if (
      lower.includes("not logged in") ||
      lower.includes("please run /login") ||
      lower.includes("invalid bearer token") ||
      lower.includes("failed to authenticate")
    ) {
      if (this.authTokenOverride) {
        return "Provided Claude auth token was rejected. Verify the token is valid/non-expired and use it as `CLAUDE_CODE_OAUTH_TOKEN` (or paste it in Settings) for Docker/headless usage.";
      }
      return "Claude Code is not authenticated. Run `claude /login` in this runtime, or set `CLAUDE_CODE_OAUTH_TOKEN` (subscription token) / `ANTHROPIC_API_KEY` for headless Docker usage.";
    }

    if (lower.includes("oauth authentication is currently not supported")) {
      return "OAuth token was sent via an unsupported auth path. Use `CLAUDE_CODE_OAUTH_TOKEN` for Claude Code subscription auth (not `ANTHROPIC_AUTH_TOKEN`).";
    }

    if (
      lower.includes("hook error") ||
      lower.includes("transcript path missing") ||
      lower.includes("configuration error in") ||
      lower.includes("is corrupted") ||
      lower.includes("cannot find module")
    ) {
      return "Claude Code settings/config appears invalid or corrupted. Restore `~/.claude.json` from the latest `.claude.json.backup.*` and keep `CLAUDE_CODE_SETTING_SOURCES=project,local`.";
    }

    return trimmed;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createClaudeCodeProvider(
  cliPath?: string,
  authToken?: string,
): ClaudeCodeProvider {
  return new ClaudeCodeProvider(cliPath, authToken);
}

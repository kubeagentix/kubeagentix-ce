import { spawn } from "child_process";
import {
  BrokerExecuteRequest,
  BrokerExecuteResponse,
  CommandAuditEvent,
  CommandPolicyDecision,
} from "@shared/terminal";
import { evaluateCommandPolicy } from "./policy";
import { CommandAdapter } from "./adapters/types";
import { kubectlAdapter } from "./adapters/kubectl";
import { dockerAdapter } from "./adapters/docker";
import { gitAdapter } from "./adapters/git";
import { shellAdapter } from "./adapters/shell";

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ALLOWED_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

const adapters = new Map<string, CommandAdapter>([
  ["kubectl", kubectlAdapter],
  ["docker", dockerAdapter],
  ["git", gitAdapter],
  ["sh", shellAdapter],
]);

export class CommandBrokerError extends Error {
  code: "COMMAND_BLOCKED" | "COMMAND_INVALID" | "COMMAND_FAILED" | "COMMAND_TIMEOUT";
  retryable: boolean;
  policyDecision?: CommandPolicyDecision;

  constructor(
    code: CommandBrokerError["code"],
    message: string,
    retryable: boolean,
    policyDecision?: CommandPolicyDecision,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.policyDecision = policyDecision;
  }
}

function redactSensitiveOutput(output: string): string {
  return output
    .replace(/(api[_-]?key\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");
}

function clampTimeout(timeoutMs?: number): number {
  if (!timeoutMs || Number.isNaN(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeoutMs, 1000), MAX_TIMEOUT_MS);
}

function clampOutputLimit(maxOutputBytes?: number): number {
  if (!maxOutputBytes || Number.isNaN(maxOutputBytes)) {
    return DEFAULT_MAX_OUTPUT_BYTES;
  }
  return Math.min(
    Math.max(maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
    MAX_ALLOWED_OUTPUT_BYTES,
  );
}

function resolveClusterContext(request: BrokerExecuteRequest): string | undefined {
  const candidate = request.clusterContext || request.context;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateOutput(
  output: string,
  maxBytes: number,
): { content: string; truncated: boolean } {
  if (Buffer.byteLength(output, "utf8") <= maxBytes) {
    return { content: output, truncated: false };
  }

  return {
    content: output.slice(0, maxBytes) + "\n...[TRUNCATED]",
    truncated: true,
  };
}

export interface CommandBrokerOptions {
  onAudit?: (event: CommandAuditEvent) => void;
}

export class CommandBroker {
  private onAudit?: (event: CommandAuditEvent) => void;

  constructor(options: CommandBrokerOptions = {}) {
    this.onAudit = options.onAudit;
  }

  async execute(request: BrokerExecuteRequest): Promise<BrokerExecuteResponse> {
    const startedAt = Date.now();
    const { decision, tokens } = evaluateCommandPolicy(request.command);

    if (!decision.allowed || !decision.family) {
      throw new CommandBrokerError(
        "COMMAND_BLOCKED",
        decision.reason || "Command blocked by policy",
        false,
        decision,
      );
    }

    const adapter = adapters.get(decision.family);
    if (!adapter) {
      throw new CommandBrokerError(
        "COMMAND_INVALID",
        `No adapter for command family: ${decision.family}`,
        false,
        decision,
      );
    }

    const { executable, args } = adapter.build(tokens, {
      clusterContext: decision.family === "kubectl" ? resolveClusterContext(request) : undefined,
    });
    const timeoutMs = clampTimeout(request.timeoutMs);
    const maxOutputBytes = clampOutputLimit(request.maxOutputBytes);

    const response = await new Promise<BrokerExecuteResponse>((resolve, reject) => {
      const child = spawn(executable, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(
          new CommandBrokerError(
            "COMMAND_FAILED",
            `Failed to execute command: ${error.message}`,
            true,
            decision,
          ),
        );
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);

        if (timedOut) {
          reject(
            new CommandBrokerError(
              "COMMAND_TIMEOUT",
              `Command timed out after ${timeoutMs}ms`,
              true,
              decision,
            ),
          );
          return;
        }

        const out = truncateOutput(redactSensitiveOutput(stdout), maxOutputBytes);
        const err = truncateOutput(redactSensitiveOutput(stderr), maxOutputBytes);
        const durationMs = Date.now() - startedAt;

        this.onAudit?.({
          command: request.command,
          family: decision.family,
          subcommand: decision.subcommand,
          startedAt,
          durationMs,
          exitCode: exitCode ?? -1,
          allowed: true,
        });

        resolve({
          stdout: out.content,
          stderr: err.content,
          exitCode: exitCode ?? -1,
          executedAt: startedAt,
          durationMs,
          policyDecision: decision,
          truncated: out.truncated || err.truncated,
        });
      });
    });

    return response;
  }
}

let broker: CommandBroker | null = null;

export function getCommandBroker(): CommandBroker {
  if (!broker) {
    broker = new CommandBroker({
      onAudit: (event) => {
        // Lightweight structured audit logging
        console.log("[command-audit]", JSON.stringify(event));
      },
    });
  }
  return broker;
}

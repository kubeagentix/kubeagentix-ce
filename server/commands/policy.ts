import { CommandFamily, CommandPolicyDecision } from "@shared/terminal";

const UNSAFE_PATTERN = /[;&|`<>\n\r]/;
const VARIABLE_SUBSTITUTION_PATTERN = /\$\(|\$\{|`/;

const ALLOWED_SUBCOMMANDS: Record<CommandFamily, Set<string>> = {
  kubectl: new Set([
    "get",
    "describe",
    "logs",
    "top",
    "events",
    "api-resources",
    "cluster-info",
    "version",
    "config",
    "explain",
  ]),
  docker: new Set(["ps", "logs", "images", "inspect", "stats", "version", "info"]),
  git: new Set([
    "status",
    "log",
    "show",
    "diff",
    "branch",
    "rev-parse",
    "remote",
  ]),
  sh: new Set(["-c"]),
};

const ALLOWED_SHELL_COMMANDS = new Set(["ls", "pwd", "echo", "cat", "kubectl", "git", "docker"]);
const SUPPORTED_BINARIES = new Set<string>(["kubectl", "docker", "git", "sh", "bash"]);

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Split command while preserving quoted groups.
 */
export function splitCommand(command: string): string[] {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => unquote(token.trim())).filter(Boolean);
}

export function getFamily(binary: string): CommandFamily | null {
  if (binary === "bash" || binary === "sh") return "sh";
  if (binary === "kubectl") return "kubectl";
  if (binary === "docker") return "docker";
  if (binary === "git") return "git";
  return null;
}

function isShellCommandAllowed(shellCommand: string): boolean {
  const head = splitCommand(shellCommand)[0];
  return !!head && ALLOWED_SHELL_COMMANDS.has(head);
}

export function evaluateCommandPolicy(command: string): {
  decision: CommandPolicyDecision;
  tokens: string[];
} {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      decision: {
        allowed: false,
        reason: "Command is empty",
      },
      tokens: [],
    };
  }

  if (UNSAFE_PATTERN.test(trimmed) || VARIABLE_SUBSTITUTION_PATTERN.test(trimmed)) {
    return {
      decision: {
        allowed: false,
        reason: "Command contains unsafe shell operators",
      },
      tokens: [],
    };
  }

  const tokens = splitCommand(trimmed);
  if (tokens.length === 0) {
    return {
      decision: {
        allowed: false,
        reason: "Command is empty",
      },
      tokens,
    };
  }

  const binary = tokens[0];
  if (!SUPPORTED_BINARIES.has(binary)) {
    return {
      decision: {
        allowed: false,
        reason: `Unsupported binary: ${binary}`,
      },
      tokens,
    };
  }

  const family = getFamily(binary);
  if (!family) {
    return {
      decision: {
        allowed: false,
        reason: `Unsupported command family for ${binary}`,
      },
      tokens,
    };
  }

  const subcommand = tokens[1] || "";

  if (!ALLOWED_SUBCOMMANDS[family].has(subcommand)) {
    return {
      decision: {
        allowed: false,
        family,
        subcommand,
        reason: `Subcommand not allowed: ${subcommand || "<none>"}`,
      },
      tokens,
    };
  }

  if (family === "sh") {
    const shellBody = tokens.slice(2).join(" ").trim();
    if (!shellBody) {
      return {
        decision: {
          allowed: false,
          family,
          subcommand,
          reason: "Shell command body is required",
        },
        tokens,
      };
    }

    if (!isShellCommandAllowed(shellBody)) {
      return {
        decision: {
          allowed: false,
          family,
          subcommand,
          reason: "Shell command not in allowlist",
        },
        tokens,
      };
    }
  }

  return {
    decision: {
      allowed: true,
      family,
      subcommand,
      matchedRule: `${family}:${subcommand}`,
    },
    tokens,
  };
}

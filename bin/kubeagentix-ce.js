#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const DIST_SERVER = path.join(rootDir, "dist", "server", "node-build.mjs");
const DIST_SPA_INDEX = path.join(rootDir, "dist", "spa", "index.html");
const KUBECTL_CHECK_ARGS = ["version", "--client"];

function usage() {
  console.log(`
KubeAgentiX CE

Usage:
  kubeagentix-ce [start]
  kubeagentix-ce doctor
  kubeagentix-ce version
  kubeagentix-ce help

Commands:
  start    Start KubeAgentiX CE (default)
  doctor   Check kubectl, kubeconfig, and environment readiness
  version  Print package version
  help     Show this help
`);
}

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function detectKubectlBinary() {
  const candidates = [
    process.env.KUBECTL_BINARY?.trim(),
    "kubectl",
    "/usr/local/bin/kubectl",
    "/opt/homebrew/bin/kubectl",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (commandExists(candidate, KUBECTL_CHECK_ARGS)) {
      return candidate;
    }
  }

  return null;
}

function resolveKubeconfigPaths() {
  if (process.env.KUBECONFIG && process.env.KUBECONFIG.trim().length > 0) {
    return process.env.KUBECONFIG.split(path.delimiter).filter(Boolean);
  }
  return [path.join(os.homedir(), ".kube", "config")];
}

function doctor() {
  const issues = [];
  const warnings = [];

  const kubectlBinary = detectKubectlBinary();
  if (!kubectlBinary) {
    issues.push(
      "kubectl not found in PATH. Install kubectl: https://kubernetes.io/docs/tasks/tools/",
    );
  }

  const kubeconfigPaths = resolveKubeconfigPaths();
  const existingConfigs = kubeconfigPaths.filter((candidate) => existsSync(candidate));
  if (existingConfigs.length === 0) {
    issues.push(
      `No kubeconfig found. Checked: ${kubeconfigPaths.join(", ")}. Configure cluster access first.`,
    );
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    warnings.push("No LLM API keys configured. AI paths will use heuristic fallback.");
  }

  console.log("KubeAgentiX CE doctor report");
  console.log(`- kubectl: ${kubectlBinary ? "ok" : "missing"}`);
  if (kubectlBinary) {
    console.log(`  using: ${kubectlBinary}`);
  }
  console.log(`- kubeconfig: ${existingConfigs.length > 0 ? "ok" : "missing"}`);
  if (existingConfigs.length > 0) {
    console.log(`  using: ${existingConfigs[0]}`);
  }
  console.log(
    `- LLM keys: ${
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY
        ? "configured"
        : "not configured"
    }`,
  );

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (issues.length > 0) {
    console.error("\nBlocking issues:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    return 1;
  }

  console.log("\nEnvironment looks ready.");
  return 0;
}

function start() {
  if (!existsSync(DIST_SERVER) || !existsSync(DIST_SPA_INDEX)) {
    console.error("Built artifacts are missing.");
    console.error(
      "If running from source, run `pnpm build` first. If running from npm, reinstall the package.",
    );
    process.exit(1);
  }

  const kubectlBinary = detectKubectlBinary();
  if (!kubectlBinary) {
    console.warn(
      "Warning: kubectl was not found in PATH. Kubernetes commands will fail until kubectl is installed.",
    );
  }

  const kubeconfigPaths = resolveKubeconfigPaths();
  if (!kubeconfigPaths.some((candidate) => existsSync(candidate))) {
    console.warn(
      `Warning: no kubeconfig found at ${kubeconfigPaths.join(", ")}. Configure cluster access for Kubernetes features.`,
    );
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.warn("Warning: no LLM API keys set. Agentic paths will run in heuristic fallback mode.");
  }

  const childEnv = { ...process.env };
  if (kubectlBinary && kubectlBinary.includes(path.sep)) {
    const kubectlDir = path.dirname(kubectlBinary);
    if (!childEnv.PATH?.split(path.delimiter).includes(kubectlDir)) {
      childEnv.PATH = `${kubectlDir}${path.delimiter}${childEnv.PATH || ""}`;
    }
  }

  const child = spawn(process.execPath, [DIST_SERVER], {
    stdio: "inherit",
    env: childEnv,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  });
}

function main() {
  const command = process.argv[2] || "start";

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(packageJson.version);
    process.exit(0);
  }

  if (command === "doctor") {
    process.exit(doctor());
  }

  if (command === "start") {
    start();
    return;
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main();

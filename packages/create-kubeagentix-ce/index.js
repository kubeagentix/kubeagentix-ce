#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const REPO_URL = "https://github.com/kubeagentix/kubeagentix-ce.git";
const DEFAULT_DIR = "kubeagentix-ce";

function printHelp() {
  console.log(`
create-kubeagentix-ce

Usage:
  npx create-kubeagentix-ce@latest [directory] [options]

Options:
  --run            Run docker compose after cloning
  --branch <name>  Clone a specific branch (default: main)
  --help           Show this help

Examples:
  npx create-kubeagentix-ce@latest
  npx create-kubeagentix-ce@latest my-kax
  npx create-kubeagentix-ce@latest --run
  `);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function parseArgs(argv) {
  let targetDir = DEFAULT_DIR;
  let runCompose = false;
  let branch = "main";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--run") {
      runCompose = true;
      continue;
    }

    if (arg === "--branch") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Missing value for --branch");
        process.exit(1);
      }
      branch = next;
      i++;
      continue;
    }

    if (!arg.startsWith("-")) {
      targetDir = arg;
      continue;
    }

    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }

  return { targetDir, runCompose, branch };
}

function main() {
  const { targetDir, runCompose, branch } = parseArgs(process.argv.slice(2));
  const targetPath = resolve(process.cwd(), targetDir);

  if (!commandExists("git")) {
    console.error("git is required but was not found in PATH.");
    process.exit(1);
  }

  if (existsSync(targetPath)) {
    console.error(`Target directory already exists: ${targetPath}`);
    process.exit(1);
  }

  console.log(`Cloning KubeAgentiX CE into ${targetDir} ...`);
  run("git", ["clone", "--depth", "1", "--branch", branch, REPO_URL, targetPath]);

  const envExample = resolve(targetPath, ".env.example");
  const envFile = resolve(targetPath, ".env");
  if (existsSync(envExample) && !existsSync(envFile)) {
    cpSync(envExample, envFile);
  }

  console.log("\nBootstrap complete.");
  console.log(`\nNext steps:\n  cd ${targetDir}`);

  if (runCompose) {
    if (!commandExists("docker")) {
      console.error("Docker was not found. Run `docker compose up --build` manually.");
      process.exit(1);
    }
    console.log("  docker compose up --build");
    run("docker", ["compose", "up", "--build"], { cwd: targetPath });
    return;
  }

  console.log("  docker compose up --build");
  console.log("  # or");
  console.log("  pnpm install && pnpm dev");
}

main();

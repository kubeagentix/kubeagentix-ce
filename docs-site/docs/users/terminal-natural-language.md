---
title: Terminal Natural Language Mode
---

# Terminal Natural Language Mode

KubeAgentiX Terminal now supports two modes:

1. `Command`: run `kubectl` commands directly.
2. `Natural Language`: describe what you want, review the generated command, then execute.

## How it works

1. Open **Terminal**.
2. Switch to **Natural Language** mode.
3. Type an intent, for example:
   - `Which namespaces can I access?`
   - `Show warning events in default namespace`
   - `Show all events in dev namespace`
   - `Show non-running pods across all namespaces`
   - `List deployments in dev`
   - `Show services across all namespaces`
   - `List nodes in the cluster`
   - `Show logs for worker-abc123 in dev`
   - `Show me pods here` (uses recent terminal context)
4. Review the generated `kubectl` command.
5. Optionally edit the command.
6. Click **Execute command**.

## Safety behavior

- Suggestions are validated by broker command policy before execution.
- If policy blocks a suggestion, execution is disabled and a reason is shown.
- If AI providers are unavailable, KubeAgentiX falls back to heuristic command suggestions.
- If the prompt is diagnosis-oriented (for example, “what's wrong with this pod?”), Terminal guides you to Chat with a one-click **Go to Chat** action.

## Notes

- This mode is advisory: commands are not auto-executed.
- Current scope is **kubectl read-only** commands for safe diagnostics.
- Terminal keeps short recent context (last commands/results) to improve follow-up NL suggestions.
- Common typos are tolerated for intent matching (for example `lsit`, `runnig`, `deplyoments`).
- **Default Namespace** in the header is a hint, not a hard restriction.
  - You can still request cross-namespace/cluster-wide queries (for example `-A` behavior).

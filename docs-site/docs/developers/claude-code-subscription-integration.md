---
title: Claude Code Subscription Integration
---

## Why This Exists

This document explains how KubeAgentiX CE integrates **Claude Code** so users can run agentic workflows with an existing Claude subscription (without requiring an Anthropic API key), and what it took to make the integration reliable.

## Goals

1. Let users use Claude-backed experiences through existing Claude Code authentication.
2. Support both local development and Docker/headless deployments.
3. Keep security boundaries clear (no hidden credential persistence in unexpected places).
4. Preserve agentic behavior (tool execution) in Chat and stable behavior in Quick Dx.

## High-Level Design

### Provider Model

KubeAgentiX CE supports multiple providers in `server/agent/providers`.

- `claude` uses Anthropic API-style credentials.
- `claude_code` uses the local Claude Code CLI runtime.
- `openai` and `gemini` are traditional API-key providers.

For subscription-backed usage, `claude_code` is the key provider.

### Claude Code Invocation Strategy

`claude_code` runs the `claude` CLI process and streams structured output:

- Command style: `claude --print ... --output-format stream-json --verbose`
- Input: prompt text via stdin
- Output: NDJSON-like streamed chunks parsed into agent response chunks
- Timeouts and process cleanup: SIGTERM + SIGKILL fallback

Implementation: `server/agent/providers/claudeCode.ts`

## Authentication Modes

### Mode A: Local interactive login (recommended for local dev)

1. User runs `claude /login` in the same runtime/user context.
2. App runs `claude_code` provider without explicit token override.
3. Provider uses local Claude auth state from CLI/runtime.

### Mode B: Headless/Docker token override

For environments where interactive login is not feasible:

- Set `CLAUDE_CODE_OAUTH_TOKEN` (preferred).
- `CLAUDE_CODE_AUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` are treated as legacy aliases.
- Optional in-app override field is supported for `claude_code` settings.

The provider normalizes auth env and can isolate config directory for token-based runs.

## Docker/Compose Fixes and Launch Workflow

This is the container-specific work we added so Claude Code subscription mode works reliably in Docker.

### Docker/Compose-specific fixes implemented

1. Runtime image now ships required CLIs:
   - `kubectl` (fixes `spawn kubectl ENOENT`)
   - `@anthropic-ai/claude-code` CLI
   - Files: `Dockerfile`
2. Compose mounts host auth/config paths into container:
   - `${HOME}/.kube:/root/.kube:ro`
   - `${HOME}/.claude:/root/.claude`
   - `${HOME}/.claude.json:/root/.claude.json`
   - File: `docker-compose.yml`
3. Entrypoint copies kubeconfig to writable temp path and exports `KUBECONFIG`, then bridges localhost cluster endpoints via `socat` to `host.docker.internal` when `KUBEAGENTIX_PROXY_LOCALHOST_KUBECONFIG=true`.
   - File: `docker/entrypoint.sh`
4. `claude_code` auth path prefers subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) and avoids stale `ANTHROPIC_API_KEY` routing unless explicitly enabled.
   - File: `server/agent/providers/claudeCode.ts`
5. Quick Dx now uses the same request-scoped provider credential flow as Chat, so settings token behavior matches between both surfaces.
   - File: `server/services/rca.ts`

### Docker Compose launch sequence

1. Prepare environment:

```bash
unset OPENAI_API_KEY GOOGLE_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN GEMINI_API_KEY
export ENABLE_CLAUDE_CODE_PROVIDER=true
# Optional for headless/container auth:
export CLAUDE_CODE_OAUTH_TOKEN='<your-claude-subscription-token>'
```

2. Launch:

```bash
docker compose down
docker compose up --build
```

3. In app Settings, select `Claude Code (Subscription)` as preferred provider.
4. If local Claude login is unavailable inside container, paste token in Settings or provide `CLAUDE_CODE_OAUTH_TOKEN` env.
5. Verify by running Quick Dx and Chat and checking provider/model debug metadata.

## What We Implemented

## 1) Claude Code provider

Added dedicated provider:

- File: `server/agent/providers/claudeCode.ts`
- Key capabilities:
  - CLI availability check (`claude --version`)
  - Stream parsing from `stream-json`
  - Timeout handling and process termination
  - Auth error normalization
  - Recovery from corrupted Claude config JSON
  - Optional token override path
  - Serialized execution lock to avoid concurrent CLI race conditions

## 2) Provider wiring and metadata

- `server/agent/providers/index.ts` exports/creates `claude_code`
- `createProvider("claude_code", apiKey, authToken)` accepts token-style override
- `server/index.ts` registers configured providers at startup

## 3) Settings UX for optional Claude Code token

UI updates:

- Optional credential field in Claude Code provider card
- Stored as `authToken` for `claude_code`

Files:

- `client/components/settings/ProviderCard.tsx`
- `client/components/settings/LLMProviderSettings.tsx`
- `client/hooks/useProviderConfig.ts`
- `client/lib/modelPreferences.ts`

## 4) Quick Dx reliability fixes

Two separate issues were fixed.

### A) Request-scoped credential poisoning

Problem:

- RCA had an isolated provider path that diverged from Chat behavior, which could cause credential mismatch and unexpected fallback.

Fix:

- Keep shared engine usage, but pass request-scoped `apiKey/authToken` through `modelPreferences`.
- Let `AgentEngine.resolveProvider(...)` create transient provider instances per request without mutating global provider state.

File: `server/services/rca.ts`

### B) Quick Dx and Chat selection mismatch

Problem:

- Quick Dx was reading stored provider/token preferences aggressively.
- Chat behavior differed, causing inconsistent outcomes.

Fix:

- Quick Dx now follows backend selection behavior compatible with chat flow.
- RCA selected-provider attempts include fallback attempts.

Files:

- `client/hooks/useRcaDiagnosis.ts`
- `server/services/rca.ts`

## 5) Claude Code tool-call compatibility

Problem:

- `claude_code` does not emit native structured tool calls like API providers.
- It can emit pseudo markup such as `<function_calls><invoke ...>`.
- Chat either showed raw markup or gave plain suggestions without tool execution.

Fix:

- Added compatibility parser in engine for Claude Code-style pseudo tool calls.
- Parsed calls are converted into real `tool_call` events, then executed.
- Tool results are synthesized back into assistant output.

Files:

- `server/agent/engine.ts`
- `server/agent/__tests__/engine.test.ts`

## 6) Debug metadata for provider/model verification

Added temporary debug visibility so users can verify provider/model per run.

- Chat displays last run provider/model.
- Quick Dx displays agentic provider/model/attempt metadata.
- Backend completion summary includes provider/model.

Files:

- `shared/coordination.ts`
- `server/agent/engine.ts`
- `shared/rca.ts`
- `server/services/rca.ts`
- `client/components/agent/ChatContainer.tsx`
- `client/hooks/useAgent.ts`
- `client/pages/QuickDx.tsx`

Toggle:

- `VITE_SHOW_PROVIDER_DEBUG=true|false`
- Declared in `.env.example`

## Roadblocks We Hit (And Resolutions)

## 1) Stale process/environment confusion

Symptom:

- User unsets keys in shell, but app still behaves as if OpenAI/Gemini keys exist.

Root cause:

- Old backend process on port `4000` still running with stale env.

Resolution:

- Kill stale listeners/processes.
- Confirm active listener PID/env before debugging behavior.

## 2) Vite proxy masking backend source

Symptom:

- "Local" frontend appeared to call local backend, but actually hit different process on `:4000`.

Resolution:

- Explicitly verify `lsof` listener and startup logs.
- Ensure only intended backend is bound to `:4000`.

## 3) Unsupported auth token assumptions

Symptom:

- Tokens from unrelated auth flows fail with `invalid x-api-key` or OAuth unsupported errors.

Resolution:

- Clarified distinction between API-key provider (`claude`) and Claude Code runtime auth (`claude_code`).
- Added clearer auth error normalization and docs.

## 4) Claude config corruption in headless contexts

Symptom:

- `.claude.json` parse errors break provider tests and agentic runs.

Resolution:

- Backup recovery logic and isolated config mode for token-driven flows.

## 5) Tool-call behavior mismatch with Claude Code

Symptom:

- Raw `<function_calls>` text in chat, no real tool execution.

Resolution:

- Compatibility parser converting markup to real tool calls in engine.

## Operational Verification Checklist

To verify Claude subscription-backed runtime is actually being used:

1. Run backend with only Claude Code provider enabled.
2. Confirm startup logs show only `claude_code` provider registration.
3. Validate `POST /api/agent/test-provider` for `claude_code` succeeds.
4. Use debug labels in Chat/Quick Dx to confirm provider/model per run.
5. Intentionally break Claude auth and verify failures are consistent with Claude Code auth errors.

## Current Tradeoffs and Limits

1. Claude Code tool compatibility currently relies on parsing text-format pseudo tool-call markup.
2. Prompt/format drift in CLI output could require parser updates.
3. Provider selection can still vary if multiple providers are enabled and request does not pin provider.
4. Docker auth behavior still depends on correct mount/env/runtime setup.

## Recommended Future Hardening

1. Move from markup parsing to a stricter SDK channel when stable and officially supported.
2. Add explicit per-request provider selection UI parity between Chat and Quick Dx.
3. Add server-side structured telemetry for provider/model/tool-call lifecycle.
4. Add end-to-end test matrix for:
   - local login mode
   - token override mode
   - Docker mode
   - fallback behavior with multi-provider env.

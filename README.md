# KubeAgentiX CE

<div align="center">
  <img src="docs-site/static/img/kubeagentix-ce-banner.png" alt="KubeAgentiX CE banner" width="760" />
</div>

<div align="center">

[![CI](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/ci.yml/badge.svg)](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/ci.yml)
[![Security](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/security.yml/badge.svg)](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/security.yml)
[![CodeQL](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/codeql.yml/badge.svg)](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/codeql.yml)
[![Docs Pages](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/docs-pages.yml/badge.svg)](https://github.com/kubeagentix/kubeagentix-ce/actions/workflows/docs-pages.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

</div>

KubeAgentiX CE is an open-source Kubernetes diagnostics copilot focused on one core workflow:

**Guided RCA -> Safe Action Plan -> Skill-driven execution**

It helps operators and developers diagnose Kubernetes incidents faster using explainable evidence from cluster data (events, logs, status, metrics) while preserving execution safety with policy-guarded command routing.

## Key Features

- Guided Quick Diagnosis (QuickDx) with confidence breakdown and evidence traces.
- AI-assisted Chat with deterministic fallback behavior.
- Terminal with dual modes:
  - Command mode (direct kubectl execution)
  - Natural Language mode (NL -> safe command suggestion -> edit -> execute)
- Skill-driven Runbooks for structured remediation workflows.
- CLI-first broker policy layer (allowlist, guardrails, typed errors, auditability).
- Browser-first architecture with optional WASM-assisted analysis helpers.

## Why CLI-First

KubeAgentiX CE intentionally uses a CLI-first execution path for Kubernetes operations:

- Reuses existing kubeconfig/context/plugin ecosystem.
- Minimizes integration overhead vs building every custom connector from scratch.
- Makes command policy enforcement explicit and testable.
- Keeps operator behavior transparent through command previews and execution logs.

## Architecture

```text
React UI (Chat, QuickDx, Runbooks, Terminal)
  -> Express API
    -> Command Broker (policy + adapters)
      -> kubectl (cluster access)
  -> Optional LLM provider enrichment
  -> WASM helpers (client-side scoring/normalization)
```

## Quickstart

### Prerequisites

- Node.js 22+
- pnpm 10+
- kubectl configured for a reachable cluster context

### Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

App runs locally with frontend + backend integration.

### Build and Test

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm --dir docs-site build
```

## Environment Variables

See `.env.example` for full set. Typical variables:

- `PORT` (default `4000`)
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `VITE_USE_WASM_CORE`

If no LLM keys are set, heuristic fallback paths remain available for core diagnosis/suggestion flows.

## Documentation

- User docs: `docs-site/docs/users/`
- Developer docs: `docs-site/docs/developers/`
- Docusaurus site: `docs-site/`

To run docs locally:

```bash
pnpm --dir docs-site install
pnpm --dir docs-site start
```

## Security

- Security policy: [SECURITY.md](./SECURITY.md)
- CI security checks include dependency review, vulnerability scan, secret scan, CodeQL, and SBOM generation.

## Contributing

Contributions are welcome.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md)
- Follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Open issues for bugs, UX gaps, and feature proposals

## Roadmap (Public)

Near-term OSS focus:

- Improve RCA precision and explainability.
- Expand skills coverage and verification flows.
- Strengthen multi-cluster context handling.
- Improve observability integrations in a non-breaking way.

## Community

- GitHub: https://github.com/kubeagentix/kubeagentix-ce
- Discussions and issues are the primary feedback channel.

## License

Apache License 2.0. See [LICENSE](./LICENSE).

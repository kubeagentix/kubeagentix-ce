# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-02-13

### Added
- Docker runtime entrypoint that prepares mounted kubeconfig and local API endpoint bridging for host-based clusters.
- Support for Anthropic bearer-token auth (`ANTHROPIC_AUTH_TOKEN`) alongside API-key auth.
- Extended Claude model catalog in provider settings and backend metadata to include current 4.5/4.6 model IDs.
- Additional provider regression tests for auth-mode resolution and empty-env handling.

### Changed
- Docker image now installs `kubectl` in the runtime stage so Kubernetes commands execute inside the container out of the box.
- Compose runtime now injects host gateway mapping and localhost kubeconfig proxy toggle defaults.
- Claude provider now auto-recovers from invalid `x-api-key` auth errors by retrying once with bearer auth when applicable.
- Provider settings and model preference plumbing now accept either API key or auth token for Claude.

### Fixed
- `spawn kubectl ENOENT` failures in Docker deployments where kubeconfig was mounted but `kubectl` binary was absent.
- TLS and connectivity failures for localhost-backed kubeconfig endpoints from containerized runtime.
- Anthropic auth resolution failures caused by empty-string `ANTHROPIC_API_KEY` env values in compose environments.

## [0.3.0] - 2026-02-10

### Added
- Guided RCA backend APIs (`/api/rca/diagnose`, `/api/rca/diagnose/:diagnosisId`) with typed shared contracts.
- Skill-based runbook system with file-backed skill packs and execution routes (`/api/skills/*`).
- Public documentation site under `/docs-site` split for user and developer audiences.
- Docusaurus documentation site under `/docs-site` split for user and developer audiences.
- DevSecOps baseline assets: `SECURITY.md` and GitHub workflows for CI, CodeQL, dependency/security scanning, and SBOM artifact generation.
- New server test coverage for skills planning/execution and RCA heuristics.

### Changed
- Runbooks UI now executes real skill data/actions while preserving the existing visual layout.
- QuickDx and Incident pages now consume live RCA results and evidence instead of static placeholders.
- Dashboard interactions now route users directly into RCA and skills workflows with live backend data.
- Agent tool handlers now resolve runbook operations via skill services.
- Vitest configuration now excludes docs-site internals to keep project tests deterministic.

## [0.2.0] - 2026-02-10

### Added
- Secure server-side command broker with policy enforcement and audit-friendly execution metadata.
- Kubernetes API routes for resources, logs, events, and metrics backed by real cluster queries.
- CLI execution endpoint with typed request/response contracts and policy decisions.
- Agent tool handlers wired to real Kubernetes and command execution paths.
- Rust `wasm-core` crate for browser-safe compute utilities with TypeScript fallback integration.

### Changed
- Frontend dashboard and hooks now use live API data instead of mock placeholders.
- Terminal UI now executes commands through the backend command broker path.
- Testing setup expanded to cover client-side DOM tests and command policy behavior.

### Fixed
- Dashboard resource loading failures caused by truncated command output parsing.
- Namespace query behavior to support all-namespaces data visibility in cluster views.

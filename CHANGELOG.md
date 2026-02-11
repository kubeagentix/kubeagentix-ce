# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

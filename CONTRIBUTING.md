# Contributing to KubeAgentiX CE

Thanks for contributing.

## Development Setup

1. Install dependencies:

```bash
pnpm install
cp .env.example .env
```

2. Start the app:

```bash
pnpm dev
```

3. Install repository git hooks:

```bash
pnpm hooks:install
```

4. Run quality gates before opening a PR:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm --dir docs-site build
```

## Pull Request Guidelines

- Keep PRs focused and scoped.
- Include tests for behavior changes.
- Update docs for user-visible changes.
- Keep command execution paths safe and policy compliant.
- Do not commit secrets or private keys.
- Follow `AGENTS.md` program rules for phased epics (Incident v1 and future programs).

## Reporting Issues

When filing an issue, include:

- Expected behavior
- Actual behavior
- Steps to reproduce
- Cluster context details (sanitized)
- Logs/screenshots where useful

## Security Reports

Please follow [SECURITY.md](./SECURITY.md) for responsible disclosure.

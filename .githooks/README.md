# Git Hooks

Install hooks for this repository:

```bash
pnpm hooks:install
```

Current hooks:

- `pre-commit`: On Incident branches (`codex/incident-v1*`), blocks code-only commits that do not include docs updates.

---
title: Quickstart for Users
---

## Prerequisites

- Node.js 22+
- kubectl installed and available on PATH
- kubeconfig/context configured (`~/.kube/config` or `KUBECONFIG`)

## Fastest Start

```bash
npx kubeagentix-ce@latest
```

The app starts on `http://localhost:4000` by default.

## Docker Alternative

```bash
git clone https://github.com/kubeagentix/kubeagentix-ce.git
cd kubeagentix-ce
cp .env.example .env
docker compose up --build
```

## First Workflow

1. Open the dashboard.
2. Select your Cluster and Default Namespace from the header.
3. Open Quick Dx and pick a failing resource.
4. Run diagnosis and review evidence + confidence.
5. Open Runbooks (Skills) to plan/execute safe actions.
6. Use Terminal Natural Language mode for command suggestions, then edit and execute.

## Troubleshooting

- kubectl not found:
  Install kubectl and ensure it is on PATH.
- kubeconfig missing:
  Configure a valid cluster context in `~/.kube/config` or `KUBECONFIG`.
- Port conflict:
  Start on a different port, for example:
  `PORT=4100 npx kubeagentix-ce@latest`

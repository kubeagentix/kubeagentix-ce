# Security Policy

KubeAgentiX CE prioritizes secure-by-default operations for Kubernetes diagnostics and execution.

## Reporting a Vulnerability

Please report vulnerabilities privately by opening a security advisory in GitHub Security tab (preferred) or by contacting the maintainers directly.

Provide:
- affected component and version,
- reproduction steps,
- impact assessment,
- suggested remediation (if available).

We will acknowledge receipt and begin triage as soon as possible.

## Supported Security Scope (CE v1)

- Local command broker policy enforcement and command allowlisting.
- Secrets redaction in command outputs.
- Dependency and vulnerability scanning in CI.
- SBOM generation for each CI security run.

## Security Baseline Controls

- SCA: dependency scanning on pull requests and main branch.
- Vulnerability scanning: repository filesystem/dependency scans.
- Secrets scanning: automated scans in CI.
- SBOM: generated and published as CI artifacts.

## Roadmap (Future Hardening)

- Signed release artifacts and provenance attestations.
- Expanded policy controls and RBAC-aware execution.
- Continuous compliance mapping (SOC2/GDPR controls inventory).

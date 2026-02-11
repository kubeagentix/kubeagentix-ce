import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy, splitCommand } from "../policy";

describe("command policy", () => {
  it("allows safe kubectl get", () => {
    const { decision } = evaluateCommandPolicy("kubectl get pods -n default");
    expect(decision.allowed).toBe(true);
    expect(decision.family).toBe("kubectl");
  });

  it("blocks dangerous shell operators", () => {
    const { decision } = evaluateCommandPolicy("kubectl get pods; rm -rf /");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/unsafe/i);
  });

  it("blocks unsupported binary", () => {
    const { decision } = evaluateCommandPolicy("python -c 'print(1)'");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Unsupported binary/i);
  });

  it("allows restricted shell with safe inner command", () => {
    const { decision } = evaluateCommandPolicy('sh -c "ls -la"');
    expect(decision.allowed).toBe(true);
    expect(decision.family).toBe("sh");
  });

  it("blocks restricted shell with non-allowlisted command", () => {
    const { decision } = evaluateCommandPolicy('sh -c "curl http://example.com"');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/allowlist/i);
  });

  it("splits quoted segments", () => {
    const tokens = splitCommand('sh -c "echo hello world"');
    expect(tokens).toEqual(["sh", "-c", "echo hello world"]);
  });
});

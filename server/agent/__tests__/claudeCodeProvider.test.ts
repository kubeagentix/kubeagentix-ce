import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeProvider } from "../providers/claudeCode";

describe("ClaudeCodeProvider auth env normalization", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CLAUDE_CODE_SKIP_STARTUP_CHECK = "true";
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_AUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sets both auth env vars when override token is provided", () => {
    const provider = new ClaudeCodeProvider(undefined, "authToken:token-123");
    const env = (provider as any).buildEnv() as NodeJS.ProcessEnv;

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token-123");
    expect(env.CLAUDE_CODE_AUTH_TOKEN).toBe("token-123");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("normalizes quoted override tokens", () => {
    const provider = new ClaudeCodeProvider(undefined, "\"token-q\"");
    const env = (provider as any).buildEnv() as NodeJS.ProcessEnv;

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token-q");
    expect(env.CLAUDE_CODE_AUTH_TOKEN).toBe("token-q");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("mirrors legacy CLAUDE_CODE_AUTH_TOKEN into CLAUDE_CODE_OAUTH_TOKEN", () => {
    process.env.CLAUDE_CODE_AUTH_TOKEN = "token-abc";
    const provider = new ClaudeCodeProvider();
    const env = (provider as any).buildEnv() as NodeJS.ProcessEnv;

    expect(env.CLAUDE_CODE_AUTH_TOKEN).toBe("token-abc");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token-abc");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("mirrors ANTHROPIC_AUTH_TOKEN into CLAUDE_CODE_OAUTH_TOKEN", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "token-xyz";
    const provider = new ClaudeCodeProvider();
    const env = (provider as any).buildEnv() as NodeJS.ProcessEnv;

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token-xyz");
    expect(env.CLAUDE_CODE_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("maps sk-ant token override to ANTHROPIC_API_KEY", () => {
    const provider = new ClaudeCodeProvider(undefined, "sk-ant-test123");
    const env = (provider as any).buildEnv() as NodeJS.ProcessEnv;

    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test123");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});

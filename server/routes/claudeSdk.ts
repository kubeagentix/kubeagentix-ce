import type { RequestHandler } from "express";
import { getClaudeSdkBridge } from "../services/claudeSdkBridge";

function wsBaseUrl(host: string | undefined, secure: boolean): string {
  const protocol = secure ? "wss" : "ws";
  return `${protocol}://${host || "localhost:4000"}`;
}

export const handleCreateClaudeSdkSession: RequestHandler = (req, res) => {
  const bridge = getClaudeSdkBridge();
  if (!bridge.isEnabled()) {
    return res.status(404).json({
      error: "Claude SDK bridge is disabled",
      code: "CLAUDE_SDK_BRIDGE_DISABLED",
    });
  }

  const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : undefined;
  const autoStart = req.body?.autoStart === true;

  try {
    const session = bridge.createSession({ cwd, autoStart });
    const baseUrl = wsBaseUrl(req.get("host"), req.secure);

    return res.status(201).json({
      session,
      browserWsUrl: `${baseUrl}/ws/browser/${encodeURIComponent(session.id)}`,
      cliWsPath: `/ws/cli/${encodeURIComponent(session.id)}`,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create session",
      code: "CLAUDE_SDK_CREATE_SESSION_ERROR",
    });
  }
};

export const handleGetClaudeSdkSession: RequestHandler = (req, res) => {
  const bridge = getClaudeSdkBridge();
  if (!bridge.isEnabled()) {
    return res.status(404).json({
      error: "Claude SDK bridge is disabled",
      code: "CLAUDE_SDK_BRIDGE_DISABLED",
    });
  }

  const sessionId = req.params.sessionId;
  const session = bridge.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "Session not found",
      code: "CLAUDE_SDK_SESSION_NOT_FOUND",
    });
  }

  return res.json({ session });
};

export const handleStartClaudeSdkSession: RequestHandler = (req, res) => {
  const bridge = getClaudeSdkBridge();
  if (!bridge.isEnabled()) {
    return res.status(404).json({
      error: "Claude SDK bridge is disabled",
      code: "CLAUDE_SDK_BRIDGE_DISABLED",
    });
  }

  const sessionId = req.params.sessionId;
  const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : undefined;

  try {
    const session = bridge.startSession(sessionId, { cwd });
    return res.json({ session });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start Claude session";
    const status = message.includes("Session not found") ? 404 : 500;
    return res.status(status).json({
      error: message,
      code:
        status === 404
          ? "CLAUDE_SDK_SESSION_NOT_FOUND"
          : "CLAUDE_SDK_START_SESSION_ERROR",
    });
  }
};

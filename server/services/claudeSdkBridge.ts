import { randomUUID } from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { IncomingMessage, Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { WebSocketServer, type WebSocket } from "ws";

type BridgeChannel = "browser" | "cli";

interface BridgeSession {
  id: string;
  createdAt: number;
  cwd?: string;
  browserSocket?: WebSocket;
  cliSocket?: WebSocket;
  cliBuffer: string;
  process?: ChildProcessWithoutNullStreams;
}

export interface BridgeSessionSnapshot {
  id: string;
  createdAt: number;
  cwd?: string;
  hasBrowserSocket: boolean;
  hasCliSocket: boolean;
  processRunning: boolean;
}

function envFlagEnabled(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function wsStateOpen(ws?: WebSocket): boolean {
  return !!ws && ws.readyState === ws.OPEN;
}

export class ClaudeSdkBridge {
  private readonly enabled = envFlagEnabled("ENABLE_CLAUDE_SDK_BRIDGE", false);
  private readonly claudeBinary = process.env.CLAUDE_SDK_CLI_PATH || "claude";
  private readonly claudeHost = process.env.CLAUDE_SDK_LOCAL_HOST || "127.0.0.1";

  private readonly sessions = new Map<string, BridgeSession>();
  private initialized = false;
  private shuttingDown = false;
  private httpServer?: HttpServer;
  private wsServer?: WebSocketServer;

  isEnabled(): boolean {
    return this.enabled;
  }

  initialize(server: HttpServer): void {
    if (!this.enabled || this.initialized) {
      return;
    }

    this.httpServer = server;
    this.wsServer = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const match = this.resolveUpgradeTarget(request);
      if (!match || !this.wsServer) {
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.onSocketConnected(match.channel, match.sessionId, ws);
      });
    });

    server.on("close", () => {
      this.shutdown();
    });

    this.initialized = true;
    console.log("✓ Claude SDK bridge enabled");
  }

  shutdown(): void {
    if (!this.initialized || this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;

    for (const [sessionId] of this.sessions) {
      this.disposeSession(sessionId);
    }

    this.wsServer?.close();
    this.sessions.clear();
    this.initialized = false;
    this.shuttingDown = false;
  }

  createSession(options: { cwd?: string; autoStart?: boolean } = {}): BridgeSessionSnapshot {
    this.assertEnabled();
    const sessionId = randomUUID();
    const session: BridgeSession = {
      id: sessionId,
      createdAt: Date.now(),
      cwd: options.cwd,
      cliBuffer: "",
    };
    this.sessions.set(sessionId, session);

    if (options.autoStart) {
      this.startSession(sessionId, { cwd: options.cwd });
    }

    return this.toSnapshot(session);
  }

  startSession(sessionId: string, options: { cwd?: string } = {}): BridgeSessionSnapshot {
    this.assertEnabled();
    const session = this.requireSession(sessionId);

    if (session.process && !session.process.killed) {
      return this.toSnapshot(session);
    }

    const sdkUrl = this.buildCliSdkUrl(sessionId);
    const cwd = options.cwd || session.cwd || process.cwd();
    const child = spawn(this.claudeBinary, ["--sdk-url", sdkUrl], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.cwd = cwd;
    session.process = child;

    child.stdout.on("data", (chunk) => {
      this.emitToBrowser(session, {
        type: "claude-stdout",
        text: chunk.toString("utf8"),
      });
    });

    child.stderr.on("data", (chunk) => {
      this.emitToBrowser(session, {
        type: "claude-stderr",
        text: chunk.toString("utf8"),
      });
    });

    child.on("error", (error) => {
      this.emitToBrowser(session, {
        type: "claude-process-error",
        error: error.message,
      });
    });

    child.on("exit", (code, signal) => {
      session.process = undefined;
      this.emitToBrowser(session, {
        type: "claude-process-exit",
        exitCode: code,
        signal: signal || null,
      });
    });

    this.emitToBrowser(session, {
      type: "claude-process-started",
      sdkUrl,
      cwd,
      command: `${this.claudeBinary} --sdk-url ${sdkUrl}`,
    });

    return this.toSnapshot(session);
  }

  getSession(sessionId: string): BridgeSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    return session ? this.toSnapshot(session) : null;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error("Claude SDK bridge is disabled");
    }
  }

  private requireSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private resolveUpgradeTarget(
    request: IncomingMessage,
  ): { channel: BridgeChannel; sessionId: string } | null {
    const url = request.url;
    if (!url) return null;

    let pathname = "";
    try {
      pathname = new URL(url, "http://localhost").pathname;
    } catch {
      return null;
    }

    const match = pathname.match(/^\/ws\/(cli|browser)\/([^/]+)$/);
    if (!match) {
      return null;
    }

    return {
      channel: match[1] as BridgeChannel,
      sessionId: decodeURIComponent(match[2]),
    };
  }

  private onSocketConnected(channel: BridgeChannel, sessionId: string, socket: WebSocket): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        createdAt: Date.now(),
        cliBuffer: "",
      };
      this.sessions.set(sessionId, session);
    }

    if (channel === "browser") {
      session.browserSocket = socket;
      this.emitToBrowser(session, {
        type: "bridge-status",
        connected: true,
        sessionId,
      });

      socket.on("message", (payload) => {
        this.onBrowserMessage(session!, payload.toString("utf8"));
      });

      socket.on("close", () => {
        if (session?.browserSocket === socket) {
          session.browserSocket = undefined;
        }
      });
      return;
    }

    session.cliSocket = socket;
    this.emitToBrowser(session, {
      type: "cli-connected",
      sessionId,
    });

    socket.on("message", (payload) => {
      this.onCliMessage(session!, payload.toString("utf8"));
    });

    socket.on("close", () => {
      if (session?.cliSocket === socket) {
        session.cliSocket = undefined;
      }
      this.emitToBrowser(session!, {
        type: "cli-disconnected",
        sessionId,
      });
    });
  }

  private onBrowserMessage(session: BridgeSession, raw: string): void {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Raw passthrough is allowed.
    }

    if (parsed?.type === "start") {
      this.startSession(session.id, {
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      });
      return;
    }

    const cliSocket = session.cliSocket;
    if (!wsStateOpen(cliSocket)) {
      this.emitToBrowser(session, {
        type: "bridge-error",
        error: "CLI websocket is not connected",
      });
      return;
    }

    if (parsed?.type === "ndjson" && typeof parsed.line === "string") {
      const line = parsed.line.endsWith("\n") ? parsed.line : `${parsed.line}\n`;
      cliSocket!.send(line);
      return;
    }

    if (parsed?.type === "raw" && typeof parsed.data === "string") {
      cliSocket!.send(parsed.data);
      return;
    }

    // Fallback: pass message body through unchanged.
    cliSocket!.send(raw);
  }

  private onCliMessage(session: BridgeSession, rawChunk: string): void {
    session.cliBuffer += rawChunk;
    const lines = session.cliBuffer.split(/\r?\n/);
    session.cliBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let data: unknown = null;
      try {
        data = JSON.parse(line);
      } catch {
        // Keep raw line available to browser if parsing fails.
      }

      this.emitToBrowser(session, {
        type: "cli-message",
        line,
        data,
      });
    }
  }

  private emitToBrowser(session: BridgeSession, payload: Record<string, unknown>): void {
    const socket = session.browserSocket;
    if (!wsStateOpen(socket)) {
      return;
    }
    socket!.send(JSON.stringify(payload));
  }

  private buildCliSdkUrl(sessionId: string): string {
    if (!this.httpServer) {
      throw new Error("Claude SDK bridge is not attached to a running HTTP server");
    }

    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not resolve HTTP port for Claude SDK bridge");
    }

    const port = (address as AddressInfo).port;
    return `ws://${this.claudeHost}:${port}/ws/cli/${encodeURIComponent(sessionId)}`;
  }

  private toSnapshot(session: BridgeSession): BridgeSessionSnapshot {
    return {
      id: session.id,
      createdAt: session.createdAt,
      cwd: session.cwd,
      hasBrowserSocket: wsStateOpen(session.browserSocket),
      hasCliSocket: wsStateOpen(session.cliSocket),
      processRunning: !!session.process && !session.process.killed,
    };
  }

  private disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (wsStateOpen(session.browserSocket)) {
      session.browserSocket!.close(1001, "Server shutdown");
    }
    if (wsStateOpen(session.cliSocket)) {
      session.cliSocket!.close(1001, "Server shutdown");
    }
    if (session.process && !session.process.killed) {
      session.process.kill("SIGTERM");
    }
  }
}

const bridge = new ClaudeSdkBridge();

export function getClaudeSdkBridge(): ClaudeSdkBridge {
  return bridge;
}

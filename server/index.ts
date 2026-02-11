import "dotenv/config";
import express, { Express, RequestHandler } from "express";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Import route handlers
import { handleDemoRoute } from "./routes/demo";
import {
  handleAgentInvoke,
  handleGetTools,
  handleGetConversation,
  handleClearConversation,
  handleTestProvider,
} from "./routes/agent";
import { handleCliExecute, handleCliSuggest } from "./routes/cli";
import {
  handleDescribeResource,
  handleGetContexts,
  handleGetEvents,
  handleGetMetrics,
  handleGetPodLogs,
  handleListResources,
} from "./routes/k8s";
import {
  handleListSkills,
  handleGetSkill,
  handlePlanSkill,
  handleExecuteSkill,
} from "./routes/skills";
import { handleDiagnoseResource, handleGetDiagnosis } from "./routes/rca";

// Import agent engine and initialize providers
import { getAgentEngine } from "./agent/engine";
import { createConfiguredProviders } from "./agent/providers";

// Environment check
const isProduction = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || "4000", 10);
const __dirname = import.meta.dirname;

/**
 * Initialize Agent Engine with providers
 */
function initializeAgentEngine() {
  const engine = getAgentEngine();

  // Register configured LLM providers from environment
  const configuredProviders = createConfiguredProviders();

  for (const [id, provider] of configuredProviders) {
    engine.registerProvider(provider);
    console.log(`✓ Registered provider: ${provider.name} (${id})`);
  }

  if (configuredProviders.size === 0) {
    console.warn(
      "⚠ No LLM providers configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY to enable providers.",
    );
  } else {
    console.log(
      `✓ Agent engine initialized with ${configuredProviders.size} provider(s)`,
    );
  }
}

/**
 * Create and configure Express server
 */
export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req, res, next) => {
    const requestId = uuidv4();
    res.setHeader("x-request-id", requestId);
    (req as any).requestId = requestId;
    console.log(`[${requestId}] ${req.method} ${req.path}`);
    next();
  });

  // Initialize agent engine
  initializeAgentEngine();

  // ============ API Routes ============

  // Demo route
  app.get("/api/ping", handleDemoRoute);

  // Agent routes
  app.post("/api/agent/invoke", handleAgentInvoke);
  app.get("/api/agent/tools", handleGetTools);
  app.get("/api/agent/conversations/:conversationId", handleGetConversation);
  app.delete(
    "/api/agent/conversations/:conversationId",
    handleClearConversation,
  );
  app.post("/api/agent/test-provider", handleTestProvider);

  // CLI command execution route
  app.post("/api/cli/execute", handleCliExecute);
  app.post("/api/cli/suggest", handleCliSuggest);

  // Kubernetes routes
  app.get("/api/k8s/resources/:resourceType", handleListResources);
  app.get("/api/k8s/resources/:resourceType/:name", handleDescribeResource);
  app.get("/api/k8s/pods/:podName/logs", handleGetPodLogs);
  app.get("/api/k8s/events", handleGetEvents);
  app.get("/api/k8s/metrics", handleGetMetrics);
  app.get("/api/k8s/contexts", handleGetContexts);

  // Guided RCA routes
  app.post("/api/rca/diagnose", handleDiagnoseResource);
  app.get("/api/rca/diagnose/:diagnosisId", handleGetDiagnosis);

  // Skill routes (runbook replacement)
  app.get("/api/skills", handleListSkills);
  app.get("/api/skills/:skillId", handleGetSkill);
  app.post("/api/skills/:skillId/plan", handlePlanSkill);
  app.post("/api/skills/:skillId/execute", handleExecuteSkill);

  // ============ Static Files (Production) ============

  if (isProduction) {
    // Serve static files from bundled SPA output
    const publicPath = path.join(__dirname, "../spa");
    app.use(express.static(publicPath));

    // SPA fallback
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(publicPath, "index.html"));
    });
  }

  // ============ Error Handler ============

  app.use(((err: Error, req, res, next) => {
    const requestId = (req as any).requestId || "unknown";
    console.error(`[${requestId}] Server error:`, err);
    res.status(500).json({
      error: err.message,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
    });
  }) as any);

  return app;
}

/**
 * Start the server
 */
export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = createServer();

    const server = app.listen(PORT, () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`\n📋 Available endpoints:`);
      console.log(
        `  POST   /api/agent/invoke            - Send message to agent`,
      );
      console.log(
        `  GET    /api/agent/tools             - List available tools`,
      );
      console.log(
        `  GET    /api/agent/conversations/:id - Get conversation history`,
      );
      console.log(`  DELETE /api/agent/conversations/:id - Clear conversation`);
      console.log(
        `  POST   /api/agent/test-provider     - Test LLM provider\n`,
      );

      resolve();
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("SIGTERM received, shutting down gracefully...");
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });
  });
}

// Start server if this file is run directly
const isNodeBuildEntrypoint = process.argv[1]?.includes("node-build");
if (import.meta.url === `file://${process.argv[1]}` && !isNodeBuildEntrypoint) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

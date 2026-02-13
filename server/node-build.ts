import path from "path";
import { createServer } from "./index";
import * as express from "express";
import { getClaudeSdkBridge } from "./services/claudeSdkBridge";

const app = createServer();
const port = process.env.PORT || 4000;

// In production, serve the built SPA files
const __dirname = import.meta.dirname;
const distPath = path.join(__dirname, "../spa");

// Serve static files
app.use(express.static(distPath));

// Handle React Router - serve index.html for all non-API routes
app.get(/.*/, (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }

  res.sendFile(path.join(distPath, "index.html"));
});

const server = app.listen(port, () => {
  console.log(`\n✓ KubeAgentiX CE running on http://localhost:${port}`);
  console.log(`📱 UI: http://localhost:${port}`);
  console.log(`🔧 API: http://localhost:${port}/api`);
});

getClaudeSdkBridge().initialize(server);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing process or run with a different port (example: PORT=4100 npx kubeagentix-ce@latest).`,
    );
    process.exit(1);
  }

  console.error("Failed to start server:", error.message);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  getClaudeSdkBridge().shutdown();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  getClaudeSdkBridge().shutdown();
  process.exit(0);
});

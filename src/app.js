require('dotenv').config()

const express = require("express");
const cron = require("node-cron");
const compression = require("compression");

const config = require("./config");
const FilesystemManager = require("./utils/filesystem");
const BatchProcessor = require("./services/batchProcessor");
const { router: uploadRouter, logProcessor } = require("./routes/upload");
const monitoringRouter = require("./routes/monitoring");

class HopeRemoteLogApp {
  constructor() {
    this.app = express();
    this.batchProcessor = new BatchProcessor();
    this.server = null;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      console.log("Initializing Hope Remote Log system...");

      // Initialize filesystem directories
      await FilesystemManager.initializeDirectories();
      console.log("Filesystem directories initialized");

      // Configure Express middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup internal cron scheduler
      this.setupScheduler();

      console.log("Application initialized successfully");
    } catch (error) {
      console.error("Failed to initialize application:", error);
      process.exit(1);
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Enable gzip compression
    this.app.use(compression());

    // Parse text/plain bodies for log upload
    this.app.use(
      "/upload-logs",
      express.text({ type: "text/plain", limit: "10mb" })
    );

    // Parse JSON for API endpoints
    this.app.use("/api", express.json());

    // Inject log processor for monitoring endpoints
    this.app.use("/api", (req, res, next) => {
      req.logProcessor = logProcessor;
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });

    // Error handling middleware
    this.app.use((error, req, res, next) => {
      console.error("Unhandled error:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    });
  }

  /**
   * Setup application routes
   */
  setupRoutes() {
    // Upload routes
    this.app.use("/", uploadRouter);

    // Monitoring routes
    this.app.use("/", monitoringRouter);

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        service: "Hope Remote Log",
        version: "1.0.0",
        status: "running",
        endpoints: {
          upload: "POST /upload-logs/:device_id",
          status: "GET /api/status",
          stats: "GET /api/stats",
          buffer: "GET /api/buffer/state",
          failures: "GET /api/failures",
        },
      });
    });

    // 404 handler
    this.app.use("*", (req, res) => {
      res.status(404).json({
        error: "Endpoint not found",
      });
    });
  }

  /**
   * Setup internal cron scheduler
   */
  setupScheduler() {
    console.log(`Setting up cron scheduler: ${config.processing.cronSchedule}`);

    cron.schedule(
      config.processing.cronSchedule,
      async () => {
        console.log("Starting scheduled batch processing...");
        try {
          await this.batchProcessor.run();
        } catch (error) {
          console.error("Scheduled batch processing failed:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log("Cron scheduler configured successfully");
  }

  /**
   * Start the server
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(config.port, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(
            `Hope Remote Log server listening on port ${config.port}`
          );
          console.log(`API Key required: ${config.apiKey}`);
          console.log(`S3 Bucket: ${config.aws.s3BucketName}`);
          console.log(`Log base path: ${config.paths.base}`);
          resolve();
        }
      });
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log("Shutting down gracefully...");

    if (this.server) {
      this.server.close();
    }

    // Wait a bit for any ongoing processing to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Shutdown complete");
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  if (app) {
    await app.shutdown();
  }
});

process.on("SIGINT", async () => {
  if (app) {
    await app.shutdown();
  }
});

// Start the application
let app;

async function main() {
  try {
    app = new HopeRemoteLogApp();
    await app.initialize();
    await app.start();
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

// Only start if this file is run directly
if (require.main === module) {
  main();
}

module.exports = HopeRemoteLogApp;

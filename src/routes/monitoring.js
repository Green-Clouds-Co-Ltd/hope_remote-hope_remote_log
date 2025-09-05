const express = require("express");
const path = require("path");
const FilesystemManager = require("../utils/filesystem");
const config = require("../config");

const router = express.Router();

/**
 * GET /api/status
 * Basic health check
 */
router.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/stats
 * High-level dashboard statistics
 */
router.get("/api/stats", async (req, res) => {
  try {
    // Get ingestion rate from log processor (will be injected)
    const ingestionRate = req.logProcessor
      ? req.logProcessor.getIngestionRate()
      : 0;

    // Read last batch run status
    const lastRunPath = path.join(config.paths.status, "last_run.json");
    const lastBatchRun = await FilesystemManager.readJsonFile(lastRunPath);

    // Get disk usage
    const diskUsagePercent = await FilesystemManager.getDiskUsage();

    res.json({
      ingestion_rate_5min: ingestionRate,
      last_batch_run: lastBatchRun || {
        status: "unknown",
        processed_at: null,
        duration_seconds: null,
      },
      disk_usage_percent: diskUsagePercent,
    });
  } catch (error) {
    console.error("Error in stats endpoint:", error);
    res.status(500).json({
      error: "Failed to retrieve statistics",
    });
  }
});

/**
 * GET /api/buffer/state
 * Real-time view of filesystem buffer state
 */
router.get("/api/buffer/state", async (req, res) => {
  try {
    const [incoming, processing, failed] = await Promise.all([
      FilesystemManager.getDirectoryStats(config.paths.incoming),
      FilesystemManager.getDirectoryStats(config.paths.processing),
      FilesystemManager.getDirectoryStats(config.paths.failed),
    ]);

    res.json({
      incoming,
      processing,
      failed,
    });
  } catch (error) {
    console.error("Error in buffer state endpoint:", error);
    res.status(500).json({
      error: "Failed to retrieve buffer state",
    });
  }
});

/**
 * GET /api/failures
 * Retrieve details for all quarantined log batches
 */
router.get("/api/failures", async (req, res) => {
  try {
    const failedFiles = await FilesystemManager.listFiles(
      config.paths.failed,
      (filename) => filename.endsWith(".log")
    );

    const failures = [];

    for (const filename of failedFiles) {
      const metaFilePath = path.join(config.paths.failed, `${filename}.meta`);
      const metaData = await FilesystemManager.readJsonFile(metaFilePath);

      if (metaData) {
        failures.push({
          file_name: filename,
          failed_at: metaData.failed_at,
          error_message: metaData.error_message,
          retry_attempts: metaData.retry_attempts || 0,
        });
      } else {
        // If no meta file, create a basic entry
        failures.push({
          file_name: filename,
          failed_at: null,
          error_message: "No metadata available",
          retry_attempts: 0,
        });
      }
    }

    res.json(failures);
  } catch (error) {
    console.error("Error in failures endpoint:", error);
    res.status(500).json({
      error: "Failed to retrieve failure information",
    });
  }
});

module.exports = router;

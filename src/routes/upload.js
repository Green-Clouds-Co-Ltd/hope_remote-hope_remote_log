const express = require("express");
const multer = require("multer");
const { authenticateApiKey } = require("../middleware/auth");
const LogProcessor = require("../utils/logProcessor");

const router = express.Router();
const logProcessor = new LogProcessor();

// Configure multer for memory storage (files will be in req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
});

/**
 * POST /supervisor/v1/:device_id/upload-logs
 * Upload log entry from device (supports both raw text and file upload)
 */
router.post(
  "/supervisor/v1/:device_id/upload-logs",
  authenticateApiKey,
  upload.single("files"),
  async (req, res) => {
    const startTime = Date.now();
    console.log(
      `[${new Date().toISOString()}] Upload request started for device: ${
        req.params.device_id
      }`
    );

    try {
      const { device_id } = req.params;
      let logMessage = req.file.buffer.toString("utf8");

      const lineCount = logMessage
        .split("\n")
        .filter((line) => line.length > 0).length;
      console.log(
        `[${new Date().toISOString()}] Processing ${lineCount} log lines for device: ${device_id}`
      );

      // Process the log request using line-by-line processing
      const result = await logProcessor.processLogContentLineByLine(
        device_id,
        logMessage
      );

      const processingTime = Date.now() - startTime;
      console.log(
        `[${new Date().toISOString()}] Upload completed successfully for device: ${device_id} - Lines processed: ${
          result.linesProcessed
        }, Files written: ${
          result.filesWritten
        }, Processing time: ${processingTime}ms`
      );

      // Return 202 Accepted as per requirements
      res.status(202).json({
        status: "accepted",
        message: "Log entry received and queued for processing",
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(
        `[${new Date().toISOString()}] Upload error for device: ${
          req.params.device_id
        } - Processing time: ${processingTime}ms`,
        error
      );

      if (
        error.message.includes("Invalid log format") ||
        error.message.includes("Invalid timestamp")
      ) {
        return res.status(400).json({
          error: error.message,
        });
      }

      res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

module.exports = { router, logProcessor };

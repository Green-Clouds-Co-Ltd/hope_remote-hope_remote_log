const express = require("express");
const multer = require("multer");
const { authenticateApiKey } = require("../middleware/auth");
const LogProcessor = require("../utils/logProcessor");

const router = express.Router();
const logProcessor = new LogProcessor();

// Configure multer for memory storage (files will be in req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
      let logMessage;

      // Validate device_id
      if (!device_id) {
        console.log(
          `[${new Date().toISOString()}] Upload failed: Missing device_id`
        );
        return res.status(400).json({
          error: "Missing device_id parameter",
        });
      }

      // Extract log message from either file upload or raw body
      if (req.file) {
        // File upload via form-data
        logMessage = req.file.buffer.toString("utf8");
        console.log(
          `[${new Date().toISOString()}] File upload detected - size: ${
            req.file.size
          } bytes, filename: ${req.file.originalname || "unknown"}`
        );
      } else if (req.body && typeof req.body === "string") {
        // Raw text upload
        logMessage = req.body;
        console.log(
          `[${new Date().toISOString()}] Raw text upload detected - size: ${
            req.body.length
          } characters`
        );
      } else {
        console.log(
          `[${new Date().toISOString()}] Upload failed: Invalid content type - no file or raw text found`
        );
        return res.status(400).json({
          error: "Invalid log message: must be plain text or uploaded file",
        });
      }

      // Validate log message content
      if (
        !logMessage ||
        typeof logMessage !== "string" ||
        logMessage.trim() === ""
      ) {
        console.log(
          `[${new Date().toISOString()}] Upload failed: Empty or invalid log content`
        );
        return res.status(400).json({
          error: "Invalid log message: must be plain text",
        });
      }

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

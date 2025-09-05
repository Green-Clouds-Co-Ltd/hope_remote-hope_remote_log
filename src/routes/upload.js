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
 * POST /upload-logs/:device_id
 * Upload log entry from device (supports both raw text and file upload)
 */
router.post(
  "/upload-logs/:device_id",
  authenticateApiKey,
  upload.single("files"),
  async (req, res) => {
    try {
      const { device_id } = req.params;
      let logMessage;

      // Validate device_id
      if (!device_id) {
        return res.status(400).json({
          error: "Missing device_id parameter",
        });
      }

      // Extract log message from either file upload or raw body
      if (req.file) {
        // File upload via form-data
        logMessage = req.file.buffer.toString("utf8");
      } else if (req.body && typeof req.body === "string") {
        // Raw text upload
        logMessage = req.body;
      } else {
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
        return res.status(400).json({
          error: "Invalid log message: must be plain text",
        });
      }

      // Process the log request using line-by-line processing
      await logProcessor.processLogContentLineByLine(device_id, logMessage);

      // Return 202 Accepted as per requirements
      res.status(202).json({
        status: "accepted",
        message: "Log entry received and queued for processing",
      });
    } catch (error) {
      console.error("Error in upload endpoint:", error);

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

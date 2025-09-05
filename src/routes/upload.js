const express = require("express");
const { authenticateApiKey } = require("../middleware/auth");
const LogProcessor = require("../utils/logProcessor");

const router = express.Router();
const logProcessor = new LogProcessor();

/**
 * POST /upload-logs/:device_id
 * Upload log entry from device
 */
router.post("/upload-logs/:device_id", authenticateApiKey, async (req, res) => {
  try {
    const { device_id } = req.params;
    const logMessage = req.body;

    // Validate inputs
    if (!device_id) {
      return res.status(400).json({
        error: "Missing device_id parameter",
      });
    }

    if (!logMessage || typeof logMessage !== "string") {
      return res.status(400).json({
        error: "Invalid log message: must be plain text",
      });
    }

    // Process the log request
    await logProcessor.processLogRequest(device_id, logMessage);

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
});

module.exports = { router, logProcessor };

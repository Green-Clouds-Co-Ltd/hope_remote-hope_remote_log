const fs = require("fs");
const path = require("path");
const config = require("../config");

class LogProcessor {
  constructor() {
    // In-memory counter for timestamp sequencing
    this.timestampCounters = new Map(); // key: "YYYY-MM-DD-HH-MM-SS", value: counter
    // Track recent requests for ingestion rate calculation
    this.recentRequests = [];
  }

  /**
   * Parse timestamp from log message and create high-resolution timestamp
   */
  parseAndEnhanceTimestamp(logMessage) {
    // Extract timestamp from log message (format: "Sep 04 12:53:01")
    const timestampRegex = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
    const match = logMessage.match(timestampRegex);

    if (!match) {
      throw new Error("Invalid log format: timestamp not found");
    }

    const timestampStr = match[1];

    // Parse the timestamp (assuming current year)
    const currentYear = new Date().getFullYear();
    const baseTimestamp = new Date(`${timestampStr} ${currentYear}`);

    if (isNaN(baseTimestamp.getTime())) {
      throw new Error("Invalid timestamp format");
    }

    // Create key for sequencing (per-second granularity)
    const secondKey = this.formatTimestampKey(baseTimestamp);

    // Get and increment counter for this second
    const counter = (this.timestampCounters.get(secondKey) || 0) + 1;
    this.timestampCounters.set(secondKey, counter);

    // Clean old counters to prevent memory leak (keep only last hour)
    this.cleanOldCounters();

    // Create high-resolution timestamp with milliseconds
    const enhancedTimestamp = new Date(baseTimestamp.getTime() + counter);

    return {
      baseTimestamp,
      enhancedTimestamp: enhancedTimestamp.toISOString(),
      hourKey: this.getHourKey(baseTimestamp),
    };
  }

  /**
   * Create a sequencing key for timestamp counters
   */
  formatTimestampKey(timestamp) {
    return timestamp.toISOString().substring(0, 19); // YYYY-MM-DDTHH:MM:SS
  }

  /**
   * Clean old timestamp counters to prevent memory leak
   */
  cleanOldCounters() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const cutoffKey = this.formatTimestampKey(oneHourAgo);

    for (const [key] of this.timestampCounters) {
      if (key < cutoffKey) {
        this.timestampCounters.delete(key);
      }
    }
  }

  /**
   * Get hour key for filename (YYYY-MM-DD-HH)
   */
  getHourKey(timestamp) {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, "0");
    const day = String(timestamp.getDate()).padStart(2, "0");
    const hour = String(timestamp.getHours()).padStart(2, "0");

    return `${year}-${month}-${day}-${hour}`;
  }

  /**
   * Create enriched log entry
   */
  createLogEntry(deviceId, logMessage) {
    const { enhancedTimestamp, hourKey } =
      this.parseAndEnhanceTimestamp(logMessage);

    return {
      logEntry: {
        device_id: deviceId,
        log_timestamp: enhancedTimestamp,
        message: logMessage,
      },
      filename: `${hourKey}.log`,
    };
  }

  /**
   * Write log entry to filesystem buffer
   */
  async writeLogEntry(logEntry, filename) {
    const filePath = path.join(config.paths.incoming, filename);
    const logLine = JSON.stringify(logEntry) + "\n";

    return new Promise((resolve, reject) => {
      // Append to file atomically
      fs.appendFile(filePath, logLine, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Track request for ingestion rate calculation
   */
  trackRequest() {
    const now = Date.now();
    this.recentRequests.push(now);

    // Keep only requests from last 5 minutes
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    this.recentRequests = this.recentRequests.filter(
      (timestamp) => timestamp > fiveMinutesAgo
    );
  }

  /**
   * Calculate ingestion rate (requests per minute over last 5 minutes)
   */
  getIngestionRate() {
    return parseFloat((this.recentRequests.length / 5).toFixed(1));
  }

  /**
   * Process incoming log request
   */
  async processLogRequest(deviceId, logMessage) {
    try {
      // Track request for rate calculation
      this.trackRequest();

      // Create enriched log entry
      const { logEntry, filename } = this.createLogEntry(deviceId, logMessage);

      // Write to filesystem buffer
      await this.writeLogEntry(logEntry, filename);

      return { success: true };
    } catch (error) {
      console.error("Error processing log request:", error);
      throw error;
    }
  }
}

module.exports = LogProcessor;

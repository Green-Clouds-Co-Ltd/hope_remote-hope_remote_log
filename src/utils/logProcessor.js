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
   * Get timestamp from log line with proper timezone conversion and millisecond indexing
   */
  getTimestampFromLog(logLine, secondIndex) {
    // Map to convert three-letter month abbreviations to zero-indexed numbers
    const months = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };

    // Regex to capture the month, day, and time components from the log line
    const match = logLine.match(
      /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/
    );

    if (!match) {
      return null;
    }

    // Destructure the captured parts from the regex match
    const [, monthStr, dayStr, timeStr] = match;

    // Parse the time components into numbers
    const [hours, minutes, seconds] = timeStr.split(":").map(Number);
    const day = parseInt(dayStr, 10);
    const monthIndex = months[monthStr];

    // Return null if the month abbreviation is invalid
    if (monthIndex === undefined) {
      return null;
    }

    // Assume the log entry's year is the current year
    const year = new Date().getFullYear();

    // Create a Date object using UTC values, treating parsed time as UTC initially
    const date = new Date(
      Date.UTC(year, monthIndex, day, hours, minutes, seconds)
    );

    // Adjust for timezone: original time was in Asia/Bangkok (UTC+7)
    // Subtract 7 hours to convert to true UTC time
    date.setUTCHours(date.getUTCHours() - 7);

    // Set milliseconds from the second index to preserve original sequence
    date.setUTCMilliseconds(secondIndex);

    // Return the timestamp in ISO 8601 format
    return date.toISOString();
  }

  /**
   * Parse timestamp from log message and create high-resolution timestamp (legacy method)
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
   * Process log content line by line
   */
  async processLogContentLineByLine(deviceId, logContent) {
    try {
      // Track request for rate calculation
      this.trackRequest();

      // Split content into lines and filter out empty lines
      const logLines = logContent.split("\n").filter((line) => line.length > 0);

      if (logLines.length === 0) return { success: false, linesProcessed: 0, filesWritten: 0 };

      // Track indices within each second to preserve ordering
      const secondCounters = new Map();

      // Process each line and collect entries by filename
      const fileEntries = new Map();

      for (const line of logLines) {
        // Get the base timestamp (without milliseconds) to use as a key
        const baseTimestamp = this.getTimestampFromLog(line, 0);
        let logTimestamp;

        if (!baseTimestamp) {
          // If no valid timestamp found, use current time
          logTimestamp = new Date().toISOString();
        } else {
          // Create a key without milliseconds (truncate to seconds)
          const secondKey = baseTimestamp.substring(0, 19) + "Z";

          // Get or initialize the counter for this second
          const currentCount = secondCounters.get(secondKey) || 0;
          secondCounters.set(secondKey, currentCount + 1);

          // Use the counter as the millisecond index
          logTimestamp =
            this.getTimestampFromLog(line, currentCount) ||
            new Date().toISOString();
        }

        // Create log entry
        const logEntry = {
          device_id: deviceId,
          log_timestamp: logTimestamp,
          message: line,
        };

        // Determine filename from timestamp
        const timestamp = new Date(logTimestamp);
        const filename = this.getHourKey(timestamp) + ".log";

        // Group entries by filename
        if (!fileEntries.has(filename)) {
          fileEntries.set(filename, []);
        }
        fileEntries.get(filename).push(logEntry);
      }

      // Write all entries to their respective files
      const writePromises = [];
      for (const [filename, entries] of fileEntries) {
        const filePath = path.join(config.paths.incoming, filename);
        const content = entries
          .map((entry) => JSON.stringify(entry) + "\n")
          .join("");

        writePromises.push(
          new Promise((resolve, reject) => {
            fs.appendFile(filePath, content, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          })
        );
      }

      await Promise.all(writePromises);

      return {
        success: true,
        linesProcessed: logLines.length,
        filesWritten: fileEntries.size,
      };
    } catch (error) {
      console.error("Error processing log content:", error);
      throw error;
    }
  }
}

module.exports = LogProcessor;

#!/usr/bin/env node

/**
 * Hope Remote Log - System Test Script
 * Tests the complete system functionality without requiring AWS setup
 */

const fs = require("fs").promises;
const path = require("path");
const http = require("http");

// Test configuration
const TEST_CONFIG = {
  baseUrl: "http://localhost:3000",
  apiKey: "test-api-key",
  testDeviceId: "test-device-001",
  logBasePath: "./test-data/logs",
};

class SystemTester {
  constructor() {
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  async runTests() {
    console.log("🚀 Starting Hope Remote Log System Tests\n");

    try {
      await this.setupTestEnvironment();
      await this.testHealthEndpoint();
      await this.testLogUpload();
      await this.testMonitoringEndpoints();
      await this.testBatchProcessing();

      console.log(
        `\n✅ Tests completed: ${this.testsPassed} passed, ${this.testsFailed} failed`
      );

      if (this.testsFailed > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error("❌ Test suite failed:", error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  async setupTestEnvironment() {
    console.log("📋 Setting up test environment...");

    // Set test environment variables
    process.env.API_KEY = TEST_CONFIG.apiKey;
    process.env.LOG_BASE_PATH = TEST_CONFIG.logBasePath;
    process.env.PORT = "3000";
    process.env.S3_BUCKET_NAME = "test-bucket";

    // Create test directories
    await this.createTestDirectories();

    // Start the application (in a separate process for real testing)
    console.log("   ✓ Test environment configured");
  }

  async createTestDirectories() {
    const dirs = [
      TEST_CONFIG.logBasePath,
      path.join(TEST_CONFIG.logBasePath, "incoming"),
      path.join(TEST_CONFIG.logBasePath, "processing"),
      path.join(TEST_CONFIG.logBasePath, "failed"),
      path.join(TEST_CONFIG.logBasePath, "status"),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async testHealthEndpoint() {
    console.log("\n🏥 Testing health endpoint...");

    try {
      const response = await this.makeRequest("GET", "/api/status");
      this.assert(
        response.status === "ok",
        "Health check should return ok status"
      );
      this.assert(response.timestamp, "Health check should include timestamp");
      console.log("   ✓ Health endpoint working");
      this.testsPassed++;
    } catch (error) {
      console.error("   ❌ Health endpoint failed:", error.message);
      this.testsFailed++;
    }
  }

  async testLogUpload() {
    console.log("\n📝 Testing log upload...");

    const testLog = "Sep 04 12:50:00 hope-vmm test log message from device";

    try {
      // Test with valid API key
      const response = await this.makeRequest(
        "POST",
        `/upload-logs/${TEST_CONFIG.testDeviceId}`,
        {
          body: testLog,
          headers: {
            Authorization: TEST_CONFIG.apiKey,
            "Content-Type": "text/plain",
          },
        }
      );

      this.assert(
        response.status === "accepted",
        "Log upload should return accepted status"
      );
      console.log("   ✓ Log upload successful");

      // Verify file was created
      await this.delay(100); // Give time for file write
      const incomingDir = path.join(TEST_CONFIG.logBasePath, "incoming");
      const files = await fs.readdir(incomingDir);
      const logFiles = files.filter((f) => f.endsWith(".log"));
      this.assert(
        logFiles.length > 0,
        "Log file should be created in incoming directory"
      );
      console.log("   ✓ Log file created in filesystem");

      this.testsPassed++;
    } catch (error) {
      console.error("   ❌ Log upload failed:", error.message);
      this.testsFailed++;
    }

    // Test authentication failure
    try {
      await this.makeRequest(
        "POST",
        `/upload-logs/${TEST_CONFIG.testDeviceId}`,
        {
          body: testLog,
          headers: {
            Authorization: "invalid-key",
            "Content-Type": "text/plain",
          },
        }
      );
      console.error("   ❌ Should have failed with invalid API key");
      this.testsFailed++;
    } catch (error) {
      if (error.statusCode === 401) {
        console.log("   ✓ Authentication properly rejected invalid API key");
        this.testsPassed++;
      } else {
        console.error("   ❌ Unexpected error:", error.message);
        this.testsFailed++;
      }
    }
  }

  async testMonitoringEndpoints() {
    console.log("\n📊 Testing monitoring endpoints...");

    try {
      // Test stats endpoint
      const stats = await this.makeRequest("GET", "/api/stats");
      this.assert(
        typeof stats.ingestion_rate_5min === "number",
        "Stats should include ingestion rate"
      );
      console.log("   ✓ Stats endpoint working");

      // Test buffer state endpoint
      const bufferState = await this.makeRequest("GET", "/api/buffer/state");
      this.assert(
        bufferState.incoming,
        "Buffer state should include incoming stats"
      );
      this.assert(
        bufferState.processing,
        "Buffer state should include processing stats"
      );
      this.assert(
        bufferState.failed,
        "Buffer state should include failed stats"
      );
      console.log("   ✓ Buffer state endpoint working");

      // Test failures endpoint
      const failures = await this.makeRequest("GET", "/api/failures");
      this.assert(Array.isArray(failures), "Failures should return an array");
      console.log("   ✓ Failures endpoint working");

      this.testsPassed++;
    } catch (error) {
      console.error("   ❌ Monitoring endpoints failed:", error.message);
      this.testsFailed++;
    }
  }

  async testBatchProcessing() {
    console.log("\n🔄 Testing batch processing logic...");

    try {
      // Create a test log file in incoming directory
      const testFile = path.join(
        TEST_CONFIG.logBasePath,
        "incoming",
        "2024-01-01-12.log"
      );
      const testData =
        JSON.stringify({
          device_id: "test-device",
          log_timestamp: "2024-01-01T12:30:00.001Z",
          message: "Test log message",
        }) + "\n";

      await fs.writeFile(testFile, testData);
      console.log("   ✓ Test log file created");

      // Test the batch processor (without S3 upload)
      const BatchProcessor = require("./src/services/batchProcessor");
      const processor = new BatchProcessor();

      // Mock S3 upload to avoid AWS dependency
      processor.uploadToS3 = async () => {
        console.log("   ✓ Mock S3 upload successful");
      };

      // Test file sweep (should move old files to processing)
      const sweptFiles = await processor.sweepCompletedFiles();
      this.assert(sweptFiles.length > 0, "Should sweep completed files");
      console.log("   ✓ File sweep working");

      this.testsPassed++;
    } catch (error) {
      console.error("   ❌ Batch processing failed:", error.message);
      this.testsFailed++;
    }
  }

  async makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
      const reqOptions = {
        hostname: "localhost",
        port: 3000,
        path: path,
        method: method,
        headers: options.headers || {},
      };

      const req = http.request(reqOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode >= 400) {
              const error = new Error(`HTTP ${res.statusCode}: ${data}`);
              error.statusCode = res.statusCode;
              reject(error);
            } else {
              const response = data ? JSON.parse(data) : {};
              resolve(response);
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on("error", reject);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cleanup() {
    console.log("\n🧹 Cleaning up test environment...");
    try {
      await fs.rm(TEST_CONFIG.logBasePath, { recursive: true, force: true });
      console.log("   ✓ Test directories removed");
    } catch (error) {
      console.warn("   ⚠️  Cleanup warning:", error.message);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new SystemTester();
  tester.runTests();
}

module.exports = SystemTester;

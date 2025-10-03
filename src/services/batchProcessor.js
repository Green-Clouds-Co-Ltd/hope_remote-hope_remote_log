const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { pipeline } = require("stream/promises");
const FilesystemManager = require("../utils/filesystem");
const config = require("../config");

class BatchProcessor {
  constructor() {
    this.s3Client = new S3Client({
      region: config.aws.region,
      credentials: config.aws.accessKeyId
        ? {
            accessKeyId: config.aws.accessKeyId,
            secretAccessKey: config.aws.secretAccessKey,
          }
        : undefined, // Use default credential chain if not provided
    });

    this.isProcessing = false;
  }

  /**
   * Main processing method called by cron
   */
  async run() {
    if (this.isProcessing) {
      console.log("Batch processing already in progress, skipping...");
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let filesProcessed = 0;
    let status = "success";

    try {
      // Update status to running
      await this.updateStatus("running", {
        started_at: new Date().toISOString(),
      });

      // Sweep phase: move completed files to processing
      const sweptFiles = await this.sweepCompletedFiles();
      console.log(`Swept ${sweptFiles.length} files to processing directory`);

      // Process each file
      for (const filename of sweptFiles) {
        try {
          await this.processFile(filename);
          filesProcessed++;
          console.log(`Successfully processed: ${filename}`);
        } catch (error) {
          console.error(`Failed to process file ${filename}:`, error);
          await this.handleFailedFile(filename, error);
          status = "failed";
        }
      }

      // Update final status
      const duration = (Date.now() - startTime) / 1000;
      await this.updateStatus(status, {
        finished_at: new Date().toISOString(),
        duration_seconds: parseFloat(duration.toFixed(1)),
        files_processed: filesProcessed,
      });

      console.log(
        `Batch processing completed. Status: ${status}, Files: ${filesProcessed}, Duration: ${duration}s`
      );
    } catch (error) {
      console.error("Critical error in batch processing:", error);
      await this.updateStatus("failed", {
        finished_at: new Date().toISOString(),
        error_message: error.message,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Update processing status
   */
  async updateStatus(status, additionalData = {}) {
    const statusData = {
      status,
      ...additionalData,
    };

    const statusPath = path.join(config.paths.status, "last_run.json");
    await FilesystemManager.writeJsonFile(statusPath, statusData);
  }

  /**
   * Sweep completed files from incoming to processing
   */
  async sweepCompletedFiles() {
    const currentHour = new Date().getHours();
    const currentDate = new Date();
    const currentHourKey = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}-${String(currentDate.getDate()).padStart(
      2,
      "0"
    )}-${String(currentHour).padStart(2, "0")}`;

    const incomingFiles = await FilesystemManager.listFiles(
      config.paths.incoming,
      (filename) =>
        filename.endsWith(".log") && !filename.startsWith(currentHourKey)
    );

    const sweptFiles = [];

    for (const filename of incomingFiles) {
      const sourcePath = path.join(config.paths.incoming, filename);
      const destPath = path.join(config.paths.processing, filename);

      try {
        await FilesystemManager.moveFile(sourcePath, destPath);
        sweptFiles.push(filename);
      } catch (error) {
        console.error(`Failed to move file ${filename}:`, error);
      }
    }

    return sweptFiles;
  }

  /**
   * Process a single file: compress and upload to S3
   */
  async processFile(filename) {
    const sourceFile = path.join(config.paths.processing, filename);
    const compressedFile = `${sourceFile}.gz`;

    try {
      // Compress the file
      await this.compressFile(sourceFile, compressedFile);

      // Upload to S3
      await this.uploadToS3(compressedFile, filename);

      // Clean up both original and compressed files
      await Promise.all([
        fs.promises.unlink(sourceFile),
        fs.promises.unlink(compressedFile),
      ]);
    } catch (error) {
      // Clean up compressed file if it exists
      try {
        await fs.promises.unlink(compressedFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Compress file using GZIP
   */
  async compressFile(inputPath, outputPath) {
    const readStream = fs.createReadStream(inputPath);
    const writeStream = fs.createWriteStream(outputPath);
    const gzipStream = zlib.createGzip();

    await pipeline(readStream, gzipStream, writeStream);
  }

  /**
   * Upload compressed file to S3 with retry logic
   */
  async uploadToS3(filePath, originalFilename, retryCount = 0) {
    try {
      const s3Key = this.generateS3Key(originalFilename);
      const fileStream = fs.createReadStream(filePath);

      const command = new PutObjectCommand({
        Bucket: config.aws.s3BucketName,
        Key: s3Key,
        Body: fileStream,
        ContentType: "application/gzip",
        ContentEncoding: "gzip",
      });

      await this.s3Client.send(command);
      console.log(`Successfully uploaded ${originalFilename} to S3: ${s3Key}`);
    } catch (error) {
      if (retryCount < config.processing.maxRetries) {
        console.log(
          `Upload failed for ${originalFilename}, retrying... (${
            retryCount + 1
          }/${config.processing.maxRetries})`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (retryCount + 1))
        ); // Exponential backoff
        return this.uploadToS3(filePath, originalFilename, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Generate S3 key with partitioning and random suffix to prevent overwrites
   */
  generateS3Key(filename) {
    // Extract date from filename (YYYY-MM-DD-HH.log)
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.log$/);
    if (!match) {
      throw new Error(`Invalid filename format: ${filename}`);
    }

    const [, year, month, day, hour] = match;
    // Add random suffix to prevent overwrites when running multiple times per hour
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const uniqueFilename = `${filename.replace(
      ".log",
      ""
    )}_${randomSuffix}.log`;
    return `${config.processing.s3KeyPrefix}/year=${year}/month=${month}/day=${day}/hour=${hour}/${uniqueFilename}.gz`;
  }

  /**
   * Handle failed file by moving to failed directory and creating metadata
   */
  async handleFailedFile(filename, error) {
    try {
      const sourceFile = path.join(config.paths.processing, filename);
      const failedFile = path.join(config.paths.failed, filename);
      const metaFile = path.join(config.paths.failed, `${filename}.meta`);

      // Move file to failed directory
      await FilesystemManager.moveFile(sourceFile, failedFile);

      // Create metadata file
      const metadata = {
        failed_at: new Date().toISOString(),
        error_message: error.message,
        retry_attempts: config.processing.maxRetries,
      };

      await FilesystemManager.writeJsonFile(metaFile, metadata);
    } catch (metaError) {
      console.error(`Failed to handle failed file ${filename}:`, metaError);
    }
  }
}

module.exports = BatchProcessor;

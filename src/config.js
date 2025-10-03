const path = require("path");

const config = {
  // Server configuration
  port: process.env.PORT || 3000,

  // Authentication
  apiKey: process.env.API_KEY || "your-api-key-here",

  // AWS configuration
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    s3BucketName: process.env.S3_BUCKET_NAME || "hope-remote-logs",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  // Filesystem paths
  paths: {
    base: process.env.LOG_BASE_PATH || "/data/logs",
    get incoming() {
      return path.join(this.base, "incoming");
    },
    get processing() {
      return path.join(this.base, "processing");
    },
    get failed() {
      return path.join(this.base, "failed");
    },
    get status() {
      return path.join(this.base, "status");
    },
  },

  // Processing configuration
  processing: {
    cronSchedule: "5,35 * * * *", // 5 and 35 minutes past every hour (twice per hour)
    maxRetries: 3,
    s3KeyPrefix: "logs",
  },
};

module.exports = config;

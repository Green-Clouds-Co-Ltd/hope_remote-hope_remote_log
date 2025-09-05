const fs = require("fs").promises;
const path = require("path");
const config = require("../config");

class FilesystemManager {
  /**
   * Initialize the required directory structure
   */
  static async initializeDirectories() {
    const directories = [
      config.paths.base,
      config.paths.incoming,
      config.paths.processing,
      config.paths.failed,
      config.paths.status,
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`Directory ensured: ${dir}`);
      } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
        throw error;
      }
    }
  }

  /**
   * Get directory statistics (file count and total size)
   */
  static async getDirectoryStats(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      let totalSize = 0;
      let fileCount = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
            fileCount++;
          }
        } catch (error) {
          // Skip files that can't be accessed
          console.warn(`Could not stat file ${filePath}:`, error.message);
        }
      }

      return {
        file_count: fileCount,
        total_size_mb: parseFloat((totalSize / (1024 * 1024)).toFixed(2)),
      };
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return { file_count: 0, total_size_mb: 0 };
    }
  }

  /**
   * Get disk usage percentage for the logs directory
   */
  static async getDiskUsage() {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);

    try {
      // Use df command to get disk usage for the logs directory
      const { stdout } = await execAsync(
        `df -h "${config.paths.base}" | tail -1`
      );
      const usage = stdout.split(/\s+/)[4]; // Get the percentage column
      return parseFloat(usage.replace("%", ""));
    } catch (error) {
      console.error("Error getting disk usage:", error);
      return 0;
    }
  }

  /**
   * List files in a directory with optional filter
   */
  static async listFiles(dirPath, filter = null) {
    try {
      const files = await fs.readdir(dirPath);
      return filter ? files.filter(filter) : files;
    } catch (error) {
      console.error(`Error listing files in ${dirPath}:`, error);
      return [];
    }
  }

  /**
   * Move file from source to destination
   */
  static async moveFile(source, destination) {
    try {
      await fs.rename(source, destination);
    } catch (error) {
      // If rename fails (cross-device), copy and delete
      await fs.copyFile(source, destination);
      await fs.unlink(source);
    }
  }

  /**
   * Read JSON file safely
   */
  static async readJsonFile(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null; // File doesn't exist
      }
      throw error;
    }
  }

  /**
   * Write JSON file atomically
   */
  static async writeJsonFile(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}

module.exports = FilesystemManager;

# Hope Remote Log - Project Structure

## 📁 Directory Layout

```
hope-remote-log/
├── src/                          # Main application source code
│   ├── app.js                    # Main application entry point
│   ├── config.js                 # Environment configuration management
│   ├── middleware/               # Express middleware
│   │   └── auth.js              # API key authentication middleware
│   ├── routes/                   # Express route handlers
│   │   ├── upload.js            # Log upload endpoint (POST /upload-logs/:device_id)
│   │   └── monitoring.js        # Monitoring API endpoints (/api/*)
│   ├── services/                 # Business logic services
│   │   └── batchProcessor.js    # Batch processing and S3 upload logic
│   └── utils/                    # Utility modules
│       ├── filesystem.js        # Filesystem operations and directory management
│       └── logProcessor.js      # Log parsing and timestamp processing
├── package.json                  # Node.js project configuration and dependencies
├── env.example                   # Environment configuration template
├── startup.sh                    # System startup script
├── test-system.js               # Comprehensive system test suite
├── DEPLOYMENT.md                # Deployment and setup guide
├── PROJECT_STRUCTURE.md         # This file - project structure documentation
└── requirements.md              # Original system requirements
```

## 🏗️ Architecture Overview

### Core Components

1. **Log Ingestion Service** (`src/app.js`, `src/routes/upload.js`)

   - Express.js web server
   - Handles `POST /upload-logs/:device_id` endpoint
   - Validates API keys via middleware
   - Processes and stores incoming logs

2. **Timestamp Processing** (`src/utils/logProcessor.js`)

   - Parses timestamps from log messages
   - Implements high-resolution sequencing
   - Creates enriched JSON log entries
   - Manages per-second counters for ordering

3. **Filesystem Buffer** (`src/utils/filesystem.js`)

   - Directory structure management (`/data/logs/{incoming,processing,failed,status}`)
   - File operations (atomic writes, moves, stats)
   - JSON file handling for metadata

4. **Batch Processing** (`src/services/batchProcessor.js`)

   - Internal cron scheduler (5 minutes past every hour)
   - File compression using GZIP
   - S3 upload with retry logic
   - Error handling and quarantine management

5. **Monitoring APIs** (`src/routes/monitoring.js`)
   - Health check (`/api/status`)
   - System statistics (`/api/stats`)
   - Buffer state (`/api/buffer/state`)
   - Failure reports (`/api/failures`)

### Data Flow

```
Device → POST /upload-logs/:device_id → Log Processing → Filesystem Buffer
                ↓
Hourly Cron → Batch Processor → GZIP Compression → S3 Upload
                ↓
Success: Cleanup | Failure: Quarantine + Metadata
```

## 📋 Key Files Description

### `src/app.js`

Main application orchestrator that:

- Initializes filesystem directories
- Sets up Express server and middleware
- Configures routes and error handling
- Starts internal cron scheduler
- Handles graceful shutdown

### `src/config.js`

Centralized configuration management:

- Environment variable parsing
- Default value handling
- Path configuration with dynamic getters
- AWS and processing settings

### `src/utils/logProcessor.js`

Core log processing logic:

- Timestamp parsing from log messages
- High-resolution timestamp generation
- In-memory sequencing counters
- Log entry enrichment and filesystem writing
- Ingestion rate tracking

### `src/services/batchProcessor.js`

Batch processing orchestration:

- File sweep from incoming to processing
- GZIP compression using streams
- S3 upload with exponential backoff retry
- Dynamic S3 key generation with partitioning
- Error handling and quarantine management

### `src/utils/filesystem.js`

Filesystem operations abstraction:

- Directory initialization and management
- File statistics and disk usage calculation
- Atomic file operations
- JSON file read/write helpers

## 🔧 Configuration

### Environment Variables

| Variable                | Required | Default      | Description                        |
| ----------------------- | -------- | ------------ | ---------------------------------- |
| `PORT`                  | No       | `3000`       | Server port                        |
| `API_KEY`               | Yes      | -            | Authentication key                 |
| `AWS_REGION`            | No       | `us-east-1`  | AWS region                         |
| `S3_BUCKET_NAME`        | Yes      | -            | S3 bucket name                     |
| `AWS_ACCESS_KEY_ID`     | No       | -            | AWS credentials (if not using IAM) |
| `AWS_SECRET_ACCESS_KEY` | No       | -            | AWS credentials (if not using IAM) |
| `LOG_BASE_PATH`         | No       | `/data/logs` | Base directory for logs            |

### File System Structure

```
/data/logs/
├── incoming/     # Active log files being written
├── processing/   # Files being compressed/uploaded
├── failed/       # Failed uploads with .meta files
└── status/       # Processing status (last_run.json)
```

## 🚀 Quick Start

1. **Install Dependencies:**

   ```bash
   npm install
   ```

2. **Configure Environment:**

   ```bash
   cp env.example .env
   # Edit .env with your settings
   ```

3. **Start Service:**

   ```bash
   ./startup.sh
   # OR
   npm start
   ```

4. **Test System:**
   ```bash
   node test-system.js
   ```

## 🧪 Testing

The `test-system.js` provides comprehensive testing:

- Health endpoint validation
- Log upload functionality
- Authentication testing
- Monitoring API verification
- Batch processing logic (with mocked S3)

## 📊 Monitoring

Access these endpoints for system monitoring:

- `GET /api/status` - Basic health check
- `GET /api/stats` - Ingestion rate, last batch run, disk usage
- `GET /api/buffer/state` - Real-time directory statistics
- `GET /api/failures` - Failed upload details

## 🔒 Security Features

- API key authentication on all upload endpoints
- Input validation and sanitization
- Error isolation (processing failures don't crash server)
- Configurable via environment variables
- No sensitive data in logs

## 🎯 Production Considerations

- Use PM2 or systemd for process management
- Set up log rotation for application logs
- Monitor disk usage of `/data/logs`
- Configure AWS IAM roles instead of access keys
- Set up CloudWatch monitoring for S3 uploads
- Implement backup strategy for failed uploads

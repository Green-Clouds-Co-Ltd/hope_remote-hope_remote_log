# **Hope Remote Log \- System Requirements Document**

## **1\. Overview**

### **1.1. Purpose**

The Hope Remote Log system is a log ingestion and processing service designed to replace a direct-to-S3 logging mechanism. Its primary goals are to reduce S3 PutObject costs, prevent backend service disruption from log upload bursts, and provide a robust, cost-effective, and scalable logging pipeline.

The system will receive raw log lines from remote devices, buffer them on a local filesystem, and then batch-process them by formatting, compressing, and uploading them to a partitioned S3 bucket once per hour.

### **1.2. High-Level Architecture**

The system consists of three main components running on a single EC2 instance:

1. **Log Ingestion Service:** A lightweight Node.js web server that provides an HTTP endpoint to receive logs and expose monitoring APIs.  
2. **Filesystem Buffer:** A structured set of directories on the local disk used for durable, temporary storage of logs and status.  
3. **Batch Processing Script:** A Node.js script, triggered by a cron job, that processes and uploads the buffered logs.

The data flows as follows:  
Device \-\> Log Ingestion Service \-\> Filesystem Buffer \-\> Batch Processing Script \-\> Amazon S3

## **2\. Component: Log Ingestion Service**

This service is responsible for receiving log data from devices, formatting it, and writing it to the filesystem buffer.

### **2.1. Endpoint**

* **Method:** POST  
* **Path:** /upload-logs/:device\_id  
* **Request Body:** The raw, plain-text log line (e.g., Sep 04 12:50:00 hope-vmm...). The Content-Type should be text/plain.

### **2.2. Authentication**

* The service must validate an API key sent in the standard HTTP header.  
* **Header Name:** Authorization (e.g., Authorization: \<YOUR\_API\_KEY\>).  
* Requests without a valid key must be rejected with a 401 Unauthorized status.

### **2.3. Processing Logic**

For each incoming request, the service must perform the following steps:

1. **Authentication & Authorization:** Validate the key provided in the Authorization header.  
2. **Parse and Refine Timestamp:**  
   * **A. Parse Base Time:** Extract the timestamp from the raw log message body (e.g., Sep 04 12:53:01). This is the base **event time**.  
   * **B. Ensure Order (Sequencing):** To handle multiple logs with the same timestamp and preserve their received order, the service must generate a high-resolution timestamp. It will maintain a lightweight, in-memory, per-second counter. The final timestamp will be the base event time with milliseconds appended from the counter (e.g., .001, .002).  
3. **Enrich Data:** Create a JSON object with the following fields:  
   * device\_id: Extracted from the URL path parameter (:device\_id).  
   * log\_timestamp: The high-resolution, sequenced timestamp.  
   * message: The original, unmodified raw log line.  
4. **Determine Target File:** Based on the **base event time's hour**, construct the target filename using the format YYYY-MM-DD-HH.log.  
5. **Write to Buffer:** Atomically append the JSON object, serialized as a single line with a trailing newline character (\\n), to the corresponding file in /data/logs/incoming/. If the file does not exist, it must be created.

### **2.4. Responses**

* **Success:** 202 Accepted  
* **Error:** 400 Bad Request, 401 Unauthorized, 500 Internal Server Error as appropriate.

## **3\. Component: Filesystem Buffer**

A structured directory layout is required for the system to function correctly.

* /data/logs/incoming/: Active write location for the Log Ingestion Service.  
* /data/logs/processing/: Staging directory for completed logs awaiting processing.  
* /data/logs/failed/: Quarantine directory for batches that failed to upload.  
* /data/logs/status/: Directory to store persistent status files for monitoring.

## **4\. Component: Batch Processing & Upload Script**

### **4.1. Trigger & Schedule**

* **Trigger:** Executable Node.js script (node process-logs.js) triggered by a system cron job.  
* **Schedule:** 5 \* \* \* \* (At 5 minutes past every hour).

### **4.2. Execution Logic**

1. **Status Update (Start):** Write to /data/logs/status/last\_run.json with { "status": "running", "started\_at": "..." }.  
2. **Sweep Phase:** Move all completed hourly log files from /data/logs/incoming/ to /data/logs/processing/.  
3. **Processing Loop:** Iterate through each file in /data/logs/processing/.  
4. **Per-File Processing:**  
   * **A. Compress:** GZIP compress the file using streams.  
   * **B. S3 Upload:** Upload the compressed file to the dynamically partitioned S3 key (logs/year=...).  
5. **Cleanup:** After successful upload, delete the original and compressed files from /data/logs/processing/.  
6. **Status Update (Success):** After all files are processed, update /data/logs/status/last\_run.json with { "status": "success", "finished\_at": "...", "duration\_seconds": X, "files\_processed": Y }.

### **4.3. Error Handling**

* **S3 Upload Failures:** Retry 3 times. If still failing:  
  * **Quarantine:** Move the original log file to /data/logs/failed/.  
  * **Write Metadata:** Create a companion .meta file (e.g., ...log.meta) in the failed directory with JSON content detailing the error: { "failed\_at": "...", "error\_message": "...", "retry\_attempts": 3 }.  
* **Status Update (Failure):** If any file fails, the final status in /data/logs/status/last\_run.json should be { "status": "failed", ... }.

## **5\. Non-Functional Requirements**

* **Durability:** No data loss.  
* **Efficiency:** All file I/O must use streams.  
* **Configuration:** Parameters must be configurable via environment variables.  
* **Dependencies:** Use official AWS SDK for JavaScript v3 (@aws-sdk/client-s3).

## **6\. Monitoring & Observability API**

The Log Ingestion Service must expose the following GET endpoints for monitoring.

### **6.1. GET /api/status**

* **Purpose:** Basic health check to confirm the service is running.  
* **Response:**  
  {  
    "status": "ok",  
    "timestamp": "2025-09-05T14:45:10.123Z"  
  }

### **6.2. GET /api/stats**

* **Purpose:** High-level dashboard statistics.  
* **Implementation:**  
  * ingestion\_rate\_5min: Calculated on-the-fly from an in-memory list of recent request timestamps.  
  * last\_batch\_run: Read directly from the /data/logs/status/last\_run.json file.  
  * disk\_usage\_percent: Calculated on-the-fly via a system call.  
* **Response:**  
  {  
    "ingestion\_rate\_5min": 6.7,  
    "last\_batch\_run": {  
      "status": "success",  
      "processed\_at": "2025-09-05T14:05:00Z",  
      "duration\_seconds": 25.4  
    },  
    "disk\_usage\_percent": 56.1  
  }

### **6.3. GET /api/buffer/state**

* **Purpose:** Real-time view of the filesystem buffer state.  
* **Implementation:** Performs a real-time scan of the log directories to count files and sum their sizes.  
* **Response:**  
  {  
    "incoming": { "file\_count": 1, "total\_size\_mb": 245.5 },  
    "processing": { "file\_count": 0, "total\_size\_mb": 0 },  
    "failed": { "file\_count": 1, "total\_size\_mb": 715.2 }  
  }

### **6.4. GET /api/failures**

* **Purpose:** Retrieve details for all quarantined log batches.  
* **Implementation:** Lists files in /data/logs/failed/ and reads the content of their corresponding .meta files.  
* **Response:**  
  \[  
    {  
      "file\_name": "2025-09-05-13.log",  
      "failed\_at": "2025-09-05T14:05:30Z",  
      "error\_message": "S3 Access Denied. Please check IAM role permissions."  
    }  
  \]  

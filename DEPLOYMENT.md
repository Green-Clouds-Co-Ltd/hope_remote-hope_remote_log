# Hope Remote Log - Deployment Guide

## Prerequisites

- **Node.js 18+**: Install from [nodejs.org](https://nodejs.org/)
- **AWS Account**: With S3 bucket created
- **EC2 Instance**: Linux-based (Ubuntu/Amazon Linux recommended)
- **IAM Role/User**: With S3 permissions

## Quick Setup

### 1. System Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# Amazon Linux
sudo yum update
sudo yum install nodejs npm
```

### 2. Application Setup

```bash
# Clone/copy the application files
cd /opt/hope-remote-log

# Install dependencies
npm install

# Create environment configuration
cp env.example .env
nano .env  # Configure your settings
```

### 3. Environment Configuration

Edit `.env` file:

```bash
# Required settings
API_KEY=your-secure-api-key-here
S3_BUCKET_NAME=your-s3-bucket-name
AWS_REGION=us-east-1

# Optional: If not using IAM roles
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: Custom log path
LOG_BASE_PATH=/data/logs
```

### 4. AWS Setup

**Create S3 Bucket:**

```bash
aws s3 mb s3://your-bucket-name --region us-east-1
```

**IAM Policy (minimum required permissions):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:PutObjectAcl"],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

### 5. Start the Service

**Manual Start:**

```bash
./startup.sh
```

**Using PM2 (recommended for production):**

```bash
# Install PM2
npm install -g pm2

# Start service
pm2 start src/app.js --name hope-remote-log

# Setup auto-restart on boot
pm2 startup
pm2 save
```

**Using systemd:**

```bash
# Create service file
sudo nano /etc/systemd/system/hope-remote-log.service
```

```ini
[Unit]
Description=Hope Remote Log Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/hope-remote-log
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable hope-remote-log
sudo systemctl start hope-remote-log
```

## Testing

### 1. Health Check

```bash
curl http://localhost:3000/api/status
```

### 2. Upload Log Test

```bash
curl -X POST \
  -H "Authorization: your-api-key-here" \
  -H "Content-Type: text/plain" \
  -d "Sep 04 12:50:00 hope-vmm test log message" \
  http://localhost:3000/upload-logs/device123
```

### 3. Monitor Stats

```bash
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/buffer/state
```

## Monitoring

- **Service Health**: `GET /api/status`
- **System Statistics**: `GET /api/stats`
- **Buffer State**: `GET /api/buffer/state`
- **Failed Uploads**: `GET /api/failures`

## Troubleshooting

### Check Logs

```bash
# PM2
pm2 logs hope-remote-log

# systemd
journalctl -u hope-remote-log -f

# Manual
tail -f /var/log/hope-remote-log.log
```

### Common Issues

1. **Permission Denied on /data/logs**:

   ```bash
   sudo chown -R ubuntu:ubuntu /data/logs
   sudo chmod -R 755 /data/logs
   ```

2. **AWS Credentials**:

   - Ensure IAM role is attached to EC2 instance, OR
   - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env

3. **Port Already in Use**:

   - Change PORT in .env file
   - Kill existing process: `sudo lsof -ti:3000 | xargs sudo kill -9`

4. **S3 Upload Failures**:
   - Verify bucket name and region
   - Check IAM permissions
   - Review failed uploads: `curl http://localhost:3000/api/failures`

## Security Considerations

- Use strong API keys
- Restrict access to the service port (use security groups/firewall)
- Run service as non-root user
- Regularly rotate AWS credentials
- Monitor log directories for disk usage

## Performance Tuning

- **Log Directory**: Use fast SSD storage for `/data/logs`
- **Network**: Ensure stable connection to S3
- **Resources**: 1 CPU, 1GB RAM minimum (2GB+ recommended for high volume)
- **Monitoring**: Set up CloudWatch/monitoring for disk usage and service health

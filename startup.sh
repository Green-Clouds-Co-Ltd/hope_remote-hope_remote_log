#!/bin/bash

# Hope Remote Log - Startup Script
# This script sets up the environment and starts the Hope Remote Log service

set -e

echo "Starting Hope Remote Log service..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

# Check Node.js version
node_version=$(node --version | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$node_version" -lt 18 ]; then
    echo "Error: Node.js version 18 or higher is required. Current version: $(node --version)"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Create log directories if they don't exist
echo "Setting up log directories..."
mkdir -p /data/logs/{incoming,processing,failed,status}

# Set proper permissions (adjust as needed for your environment)
chmod -R 755 /data/logs

echo "Log directories created successfully"

# Check if environment file exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Using default configuration."
    echo "Copy env.example to .env and configure your settings."
fi

# Start the application
echo "Starting Hope Remote Log service..."
exec npm start

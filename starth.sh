#!/bin/bash

# Print FFmpeg version for verification
echo "FFmpeg version:"
ffmpeg -version

echo "FFprobe version:"
ffprobe -version

# Start your Node.js application
node dist/app.js
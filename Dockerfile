# Build stage
FROM node:21-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy pre-built JavaScript files
COPY dist ./dist

# Production stage
FROM node:21-slim

WORKDIR /app

# Install FFmpeg and other necessary tools
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Ensure FFmpeg is in the PATH
ENV PATH="/usr/bin:${PATH}"

# Verify FFmpeg installation
RUN ffmpeg -version && ffprobe -version

EXPOSE 5007

# Add a startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
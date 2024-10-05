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

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 5007
CMD ["node", "dist/app.js"]
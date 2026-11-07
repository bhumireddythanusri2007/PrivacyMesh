# Multi-stage build for React 19 + Vite frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install clean dependencies
RUN npm ci

# Copy application source code
COPY . .

# Build arguments for Vite environment
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

# Compile TypeScript and bundle production assets
RUN npm run build

# Stage 2: Minimal Nginx web server
FROM nginx:alpine

# Copy built distribution files to Nginx web root
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Health check to ensure Nginx is serving the frontend
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

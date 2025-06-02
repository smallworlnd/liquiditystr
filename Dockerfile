# Base stage with common Python configuration
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

# Frontend build stage
FROM node:18-alpine AS frontend-builder
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci && \
    npm install --save-dev @sveltejs/adapter-static && \
    npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# Python dependencies stage
FROM base AS python-builder
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create virtual environment and install dependencies
RUN python -m venv $VIRTUAL_ENV && \
    pip install --no-cache-dir publsp

# Final runtime stage
FROM base AS runtime

# Copy virtual environment from builder
COPY --from=python-builder ${VIRTUAL_ENV} ${VIRTUAL_ENV}

# Copy built frontend from frontend-builder stage
COPY --from=frontend-builder /app/build ./build

# Copy application files
COPY run_liquiditystr.py ./

# Expose port
EXPOSE 8000

# Start application
ENTRYPOINT ["python", "run_liquiditystr.py"]

# Use a base image that has both Python and Node.js
# We'll use a Python base and install Node.js
FROM python:3.11-slim

# Install system dependencies (libsndfile is needed for librosa/soundfile)
RUN apt-get update && apt-get install -y \
    curl \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

WORKDIR /app

# Copy dependency files first for caching
COPY backend/ai_engine/requirements.txt ./backend/ai_engine/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r backend/ai_engine/requirements.txt

# Copy the rest of the application
COPY . .

# Environment variables
ENV PORT=5501
ENV AI_ENGINE_URL=http://127.0.0.1:8000

# Expose the Node.js port
EXPOSE 5501

# Create a startup script
RUN echo '#!/bin/bash\n\
    # Start AI Engine in background\n\
    cd backend/ai_engine && uvicorn main:app --host 127.0.0.1 --port 8000 & \n\
    \n\
    # Start Node.js Server in foreground\n\
    cd backend && node server.js --port 5501\n\
    ' > /app/start.sh && chmod +x /app/start.sh

# Start command
CMD ["/app/start.sh"]

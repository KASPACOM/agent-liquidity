FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build config
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm install -g typescript && \
    tsc && \
    npm uninstall -g typescript

# Expose port
EXPOSE 3003

# Run
CMD ["npm", "start"]

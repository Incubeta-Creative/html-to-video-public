
# Use the official Node.js 18 Slim image from Docker Hub
FROM node:18-slim

# Install necessary packages for the Node.js app
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy the rest of the application code to the container image
COPY . .

# Expose port 8080
EXPOSE 8080

# Run the web service on container startup
CMD ["node", "index.js"]

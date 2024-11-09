# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy the rest of the files
COPY . .

# Expose the port
EXPOSE 5000

# Define a volume for persistent storage
VOLUME ["/configs"]

# Start the server
CMD ["bun", "run", "index.ts"]
# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (adjust if different)
EXPOSE 5000

# Start the server
CMD ["bun", "run", "index.ts"]
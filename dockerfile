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

# Copy the public directory to the static directory
RUN cp -r /public /static

# Define a volume for persistent storage
VOLUME ["/public"]

# Copy the entrypoint script
COPY docker-entrypoint.sh /

# Make the entrypoint script executable
RUN chmod +x /docker-entrypoint.sh

# Run the entrypoint script
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start the server
CMD ["bun", "run", "index.ts"]
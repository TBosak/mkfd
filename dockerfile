FROM oven/bun:1.2.2-debian
ARG NODE_VERSION=22.14.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) NODE_ARCH="x64" ;; \
      arm64) NODE_ARCH="arm64" ;; \
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 && \
    node --version

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

RUN set -eux; \
  ok=0; \
  for i in 1 2 3 4 5; do \
    if bunx patchright install --with-deps chromium; then ok=1; break; fi; \
    echo "patchright install failed (attempt $i), retrying..."; \
    sleep $((i * 5)); \
  done; \
  [ "$ok" -eq 1 ]

COPY . .

RUN mkdir -p /app/configs /app/extensions \
 && chmod -R 755 /app/configs /app/extensions

EXPOSE 5000

VOLUME ["/app/configs", "/app/extensions"]

HEALTHCHECK --interval=5m --timeout=10s --start-period=1m --retries=3 \
  CMD curl -f http://localhost:5000/ || exit 1

CMD ["bun", "run", "index.ts"]

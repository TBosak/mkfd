# Pinned by digest, not just by tag, so the bytes cannot be repointed under us.
# This digest is oven/bun:1.2.2-debian as published 2025-02-01, read from the
# Docker Hub registry API. Re-verify or refresh the digest with:
#   docker buildx imagetools inspect oven/bun:1.2.2-debian
FROM oven/bun:1.2.2-debian@sha256:93b7f5ea6626bb3a8f0fce85b89dcdc2d53aa61963c04316ee622de2ca3bd799
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
RUN bun install --frozen-lockfile

RUN set -eux; \
  ok=0; \
  for i in 1 2 3 4 5; do \
    if bunx patchright install --with-deps chromium; then ok=1; break; fi; \
    echo "patchright install failed (attempt $i), retrying..."; \
    sleep $((i * 5)); \
  done; \
  [ "$ok" -eq 1 ]

COPY . .

# Owned by the unprivileged runtime user rather than made world-readable.
# /app/configs holds every stored credential, so a blanket 755 would expose
# it to any other process in the container; ownership is what the app
# actually needs in order to write.
RUN mkdir -p /app/configs /app/extensions /app/data \
 && chown -R bun:bun /app/configs /app/extensions /app/data

EXPOSE 5000

VOLUME ["/app/configs", "/app/extensions"]

HEALTHCHECK --interval=5m --timeout=10s --start-period=1m --retries=3 \
  # -L matters: / now answers 302 to /passkey, and curl -f without it treats
  # that redirect as success — so the check passed against an app that was
  # entirely broken behind the redirect.
  CMD curl -fsSL http://localhost:5000/ || exit 1

# Last, after all privileged setup: apt-get, the Node.js download, bun
# install and the Chromium download all need root; the application does not.
# It drives headless Chromium against attacker-influenced pages and mounts
# the credential store, so it must not also be uid 0.
USER bun

CMD ["bun", "run", "index.ts"]

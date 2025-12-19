FROM oven/bun:1.2.2-debian
ARG NODE_MAJOR=22
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*

RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' \
    > /etc/apt/apt.conf.d/80-retries

RUN if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list; \
    fi && \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    fi

RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

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

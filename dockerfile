FROM oven/bun:1.2.2-debian

RUN apt-get update && apt-get install -y \
    curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_23.x | bash - \
 && apt-get install -y nodejs

 ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
 RUN bunx patchright install --with-deps chrome

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY . .

EXPOSE 5000

VOLUME ["/app/configs"]

CMD ["bun", "run", "index.ts"]
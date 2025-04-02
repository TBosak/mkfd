FROM oven/bun:debian

RUN apt-get update && apt-get install -y bash curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install

COPY . .

EXPOSE 5000

VOLUME ["/app/configs"]

CMD ["bun", "run", "index.ts"]
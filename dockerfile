FROM oven/bun:alpine

RUN apk update && apk add --no-cache bash curl

ENV NODE_VERSION=23.6.0


RUN curl -fsSL https://nodejs.org/dist/v23.6.0/node-v23.6.0-linux-x64.tar.xz \
    -o /tmp/node.tar.xz \
 && tar -C /usr/local --strip-components 1 -xJf /tmp/node.tar.xz \
 && rm /tmp/node.tar.xz

RUN node -v
WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install

COPY . .

EXPOSE 5000

VOLUME ["/configs"]

CMD ["bun", "run", "index.ts"]
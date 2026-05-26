import { Hono } from "hono";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

export function filesystemRouter(): Hono {
  const app = new Hono();

  app.get("/filesystem/inspect", async (ctx) => {
    const root = process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd();
    const exists = existsSync(root);
    const stats = exists ? await stat(root).catch(() => null) : null;
    return ctx.json({
      rootPath: root,
      exists,
      readable: Boolean(stats?.isDirectory()),
      publicServing: process.env.FILESYSTEM_FEEDS_PUBLIC_SERVING === "true",
    });
  });

  return app;
}

import { Hono } from "hono";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import * as yaml from "js-yaml";
import { getCatalogFeed, getCatalogManifest } from "../utilities/community-catalog/catalog-client.utility";
import { buildCatalogSubmissionBundle, sanitizeForCommunityCatalog } from "../utilities/community-catalog/catalog-sanitizer.utility";
import { renderFeedConfigTemplate } from "../utilities/feed-template.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { maskProtectedValues } from "../utilities/protected-values.utility";
import { readFeedConfig } from "../utilities/config-manager.utility";
import { setFeedUpdaterInterval } from "../utilities/worker-manager.utility";

export function catalogRouter(deps: {
  encryptionKey: string;
  configsDir: string;
}): Hono {
  const app = new Hono();
  const { encryptionKey, configsDir } = deps;

  app.get("/api/catalog", async (ctx) => {
    try {
      return ctx.json(await getCatalogManifest());
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Failed to load catalog" }, 500);
    }
  });

  app.get("/api/catalog/:id", async (ctx) => {
    try {
      return ctx.json(await getCatalogFeed(ctx.req.param("id")));
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Catalog feed not found" }, 404);
    }
  });

  app.post("/api/catalog/:id/preview-template", async (ctx) => {
    try {
      const detail = await getCatalogFeed(ctx.req.param("id"));
      const body = await ctx.req.json().catch(() => ({}));
      const config = renderFeedConfigTemplate(detail.config, {
        feedId: "catalog-preview",
        encryptionKey,
        values: body.values ?? {},
        secretStorage: body.secretStorage ?? {},
        origin: { type: "community", catalogId: detail.entry.id },
      });
      return ctx.json({ config: maskProtectedValues(config) });
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Failed to preview template" }, 400);
    }
  });

  app.post("/api/catalog/:id/import", async (ctx) => {
    try {
      const detail = await getCatalogFeed(ctx.req.param("id"));
      const body = await ctx.req.json().catch(() => ({}));
      const feedId = uuidv4();
      const rendered = renderFeedConfigTemplate(detail.config, {
        feedId,
        encryptionKey,
        values: body.values ?? {},
        secretStorage: body.secretStorage ?? {},
        origin: { type: "community", catalogId: detail.entry.id },
      });
      const finalConfig = {
        ...rendered,
        feedId,
        feedName: String(rendered.feedName ?? detail.entry.title),
        metadata: {
          ...((rendered.metadata as Record<string, unknown>) ?? {}),
          catalogId: detail.entry.id,
          category: detail.entry.category,
          tags: detail.entry.tags,
        },
      };
      const validation = validateFeedConfig(finalConfig as any);
      if (!validation.valid) {
        return ctx.json({ errors: validation.errors, warnings: validation.warnings }, 400);
      }
      await writeFile(join(configsDir, `${feedId}.yaml`), yaml.dump(finalConfig), "utf8");
      setFeedUpdaterInterval(finalConfig as any);
      return ctx.json({ feedId, config: maskProtectedValues(finalConfig), warnings: validation.warnings }, 201);
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Failed to import catalog feed" }, 400);
    }
  });

  app.post("/api/catalog/submission/:feedId", async (ctx) => {
    try {
      const feedId = ctx.req.param("feedId");
      const config = await readFeedConfig(feedId, configsDir);
      const body = await ctx.req.json();
      const result = sanitizeForCommunityCatalog(config as any, body);
      return ctx.json(result);
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Failed to sanitize feed" }, 400);
    }
  });

  app.post("/api/catalog/submission/:feedId/bundle", async (ctx) => {
    try {
      const feedId = ctx.req.param("feedId");
      const config = await readFeedConfig(feedId, configsDir);
      const body = await ctx.req.json();
      const result = buildCatalogSubmissionBundle(config as any, body);
      if (!result.bundle) return ctx.json(result.result, 400);
      return ctx.json(result);
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Failed to build catalog bundle" }, 400);
    }
  });

  return app;
}

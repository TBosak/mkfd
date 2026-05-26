/**
 * Feeds Routes
 *
 * POST /                         — create feed
 * GET  /api/feeds                — list feeds
 * GET  /api/feeds/:id/config     — get feed config
 * PUT  /api/feeds/:id            — update feed
 * PATCH /api/feeds/:id/metadata  — update metadata fields
 * PATCH /api/feeds/:id/enabled   — toggle enabled
 * POST /api/feeds/:id/duplicate  — duplicate feed
 * GET  /api/feeds/:id/export     — export feed config as YAML
 * DELETE /api/feeds/:id          — delete feed
 * POST /delete-feed              — legacy delete (form-based)
 * GET  /feeds                    — SPA catch-all
 * GET  /feeds/:id/edit           — SPA catch-all
 */

import { file } from "bun";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import * as yaml from "js-yaml";
import { desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getDb } from "../lib/analytics/db";
import * as analyticsSchema from "../lib/analytics/schema";
import {
  listFeedConfigs,
  readFeedConfig,
  deleteFeedConfig,
  duplicateFeedConfig,
  exportFeedConfig,
  assertSafeFeedId,
} from "../utilities/config-manager.utility";
import { patchMetadata, patchEnabled } from "../utilities/config-metadata.utility";
import { buildFeedSummary } from "../utilities/feed-summary.utility";
import { maskProtectedValues, preserveMaskedProtectedValues } from "../utilities/protected-values.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import {
  assertOutboundFetchAllowed,
  mergeFeedPolicyOptions,
  parseAllowlist,
  type OutboundFetchPolicyOptions,
} from "../utilities/outbound-fetch-policy.utility";
import {
  normalizeUrl,
  axiosGetWithPolicyRedirects,
  assembleFormBody,
  fetchSampleHtml,
} from "../utilities/feed-config-route-adapter.utility";
import {
  setFeedUpdaterInterval,
  clearFeedUpdaterInterval,
  terminateWorker,
} from "../utilities/worker-manager.utility";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getGlobalFetchPolicyOptions(): OutboundFetchPolicyOptions {
  return {
    allowPrivateFetches: process.env.ALLOW_PRIVATE_FETCHES === "true",
    allowlist: parseAllowlist(process.env.OUTBOUND_FETCH_ALLOWLIST),
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function feedsRouter(deps: {
  encryptionKey: string;
  configsDir: string;
  feedPath: string;
}): Hono {
  const { encryptionKey, configsDir, feedPath } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // POST / — create feed
  // -------------------------------------------------------------------------

  app.post("/", async (ctx) => {
    const feedId = uuidv4();
    const contentType = ctx.req.header("Content-Type") || "";

    let body: Record<string, any>;
    let sampleHtml = "";

    try {
      if (contentType.includes("application/json")) {
        body = await ctx.req.json();
      } else if (
        contentType.includes("multipart/form-data") ||
        contentType.includes("application/x-www-form-urlencoded")
      ) {
        const formData = await ctx.req.formData();
        const raw = Object.fromEntries(formData as any);
        body = assembleFormBody(raw);
      } else {
        return ctx.text("Unsupported Content-Type.", 415);
      }

      if (body.feedType === "webScraping" && body.feedUrl) {
        try {
          const sampleHtmlPolicyOptions = mergeFeedPolicyOptions(
            getGlobalFetchPolicyOptions(),
            body,
          );
          await assertOutboundFetchAllowed(body.feedUrl, sampleHtmlPolicyOptions);
          sampleHtml = await fetchSampleHtml({
            feedUrl: body.feedUrl,
            body,
            policyOptions: sampleHtmlPolicyOptions,
          });
        } catch (e: any) {
          if (e?.message?.startsWith("Outbound fetch blocked")) {
            throw e;
          }
          console.warn("Could not fetch sample HTML for URL analysis:", e.message);
          sampleHtml = "";
        }
      }
    } catch (e: any) {
      if (e?.message?.startsWith("Outbound fetch blocked")) {
        return ctx.text(e.message, 403);
      }
      console.error("Error parsing request body:", e);
      return ctx.text("Invalid request body.", 400);
    }

    let finalFeedConfig: any;
    try {
      finalFeedConfig = castFeedFormDataToFeedConfig(body as any, {
        feedId,
        encryptionKey,
      });
    } catch (castErr: any) {
      if (contentType.includes("application/json")) {
        return ctx.json(
          { errors: [{ path: "feedType", message: castErr.message }] },
          400,
        );
      }
      return ctx.text(castErr.message, 400);
    }

    const validation = validateFeedConfig(finalFeedConfig);
    if (!validation.valid) {
      if (contentType.includes("application/json")) {
        return ctx.json(
          { errors: validation.errors, warnings: validation.warnings },
          400,
        );
      }
      return ctx.text(
        validation.errors.map((e: any) => e.message).join("\n"),
        400,
      );
    }

    const yamlStr = yaml.dump(finalFeedConfig);
    const yamlFilePath = join(configsDir, `${feedId}.yaml`);
    await writeFile(yamlFilePath, yamlStr, "utf8");

    setFeedUpdaterInterval(finalFeedConfig);

    if (contentType.includes("application/json")) {
      return ctx.json({
        message: "RSS feed is being generated.",
        feedUrls: {
          rss2: `/public/feeds/${feedId}.xml`,
          atom: `/public/feeds/${feedId}.atom`,
          json: `/public/feeds/${feedId}.json`,
        },
        feedId,
        config: maskProtectedValues(finalFeedConfig),
      });
    }

    return ctx.html(`
    <p>Your RSS feed is being generated and will update every ${finalFeedConfig.refreshTime} minutes.</p>
    <p>Access it at: <a href="/public/feeds/${feedId}.xml">/public/feeds/${feedId}.xml</a></p>
    <p><a href="/feeds">View all feeds</a></p>
  `);
  });

  // -------------------------------------------------------------------------
  // GET /api/feeds — list feeds
  // -------------------------------------------------------------------------

  app.get("/api/feeds", async (ctx) => {
    const sqlite = getDb();
    const db = drizzle(sqlite, { schema: analyticsSchema });
    const files = await listFeedConfigs();
    const feedIds = files.map((f) => f.id);
    const allRuns = feedIds.length
      ? await db
          .select()
          .from(analyticsSchema.runLogs)
          .where(inArray(analyticsSchema.runLogs.feedId, feedIds))
          .orderBy(desc(analyticsSchema.runLogs.startedAt))
      : [];
    const lastRunMap = new Map<string, (typeof allRuns)[0]>();
    for (const run of allRuns) {
      if (!lastRunMap.has(run.feedId)) lastRunMap.set(run.feedId, run);
    }
    const summaries = await Promise.all(
      files.map(async (f) => {
        const config = await readFeedConfig(f.id);
        return buildFeedSummary(f, config, lastRunMap.get(f.id));
      }),
    );
    return ctx.json({ feeds: summaries });
  });

  // -------------------------------------------------------------------------
  // GET /api/feeds/:id/config — get feed config
  // -------------------------------------------------------------------------

  app.get("/api/feeds/:id/config", async (ctx) => {
    const rawId = ctx.req.param("id").replace(/\.yaml$/, "");
    try {
      assertSafeFeedId(rawId);
    } catch {
      return ctx.json({ error: "Invalid feed ID" }, 400);
    }
    const feedId = rawId;
    const configPath = join(configsDir, `${feedId}.yaml`);

    if (!existsSync(configPath)) {
      return ctx.json({ error: "Feed not found" }, 404);
    }

    const yamlContent = await readFile(configPath, "utf8");
    const raw = yaml.load(yamlContent) as Record<string, unknown>;
    const config = normalizeLoadedFeedConfig(raw);
    return ctx.json(maskProtectedValues(config));
  });

  // -------------------------------------------------------------------------
  // PUT /api/feeds/:id — update feed
  // -------------------------------------------------------------------------

  app.put("/api/feeds/:id", async (ctx) => {
    const rawId = ctx.req.param("id").replace(/\.yaml$/, "");
    try {
      assertSafeFeedId(rawId);
    } catch {
      return ctx.json({ error: "Invalid feed ID" }, 400);
    }
    const feedId = rawId;
    const configPath = join(configsDir, `${feedId}.yaml`);

    if (!existsSync(configPath)) {
      return ctx.json({ error: "Feed not found" }, 404);
    }

    const existingYaml = await readFile(configPath, "utf8");
    const existingConfigRaw = yaml.load(existingYaml) as Record<string, unknown>;
    const existingConfig = normalizeLoadedFeedConfig(existingConfigRaw);

    const contentType = ctx.req.header("Content-Type") || "";
    let body: Record<string, any>;
    let sampleHtml = "";

    try {
      if (contentType.includes("application/json")) {
        body = await ctx.req.json();
      } else {
        return ctx.text("Unsupported Content-Type.", 415);
      }

      if (body.feedType === "webScraping" && body.feedUrl) {
        try {
          const putSamplePolicyOptions = mergeFeedPolicyOptions(
            getGlobalFetchPolicyOptions(),
            body,
          );
          await assertOutboundFetchAllowed(body.feedUrl, putSamplePolicyOptions);
          sampleHtml = await fetchSampleHtml({
            feedUrl: body.feedUrl,
            body,
            policyOptions: putSamplePolicyOptions,
          });
        } catch (e: any) {
          if (e?.message?.startsWith("Outbound fetch blocked")) {
            throw e;
          }
          console.warn("Could not fetch sample HTML for URL analysis:", e.message);
        }
      }
    } catch (e: any) {
      if (e?.message?.startsWith("Outbound fetch blocked")) {
        return ctx.text(e.message, 403);
      }
      console.error("Error parsing request body:", e);
      return ctx.text("Invalid request body.", 400);
    }

    // 1. Cast — encrypts new protected values, leaves "********" alone
    let castConfig: any;
    try {
      castConfig = castFeedFormDataToFeedConfig(body as any, {
        feedId,
        encryptionKey,
      });
    } catch (castErr: any) {
      return ctx.json(
        { errors: [{ path: "feedType", message: castErr.message }] },
        400,
      );
    }

    // 2. Preserve — restores "********" sentinels to original ciphertext
    const finalFeedConfig = preserveMaskedProtectedValues(castConfig, existingConfig);

    // 2a. Restore email password if edit mode with no password change
    if (
      finalFeedConfig.feedType === "email" &&
      !(finalFeedConfig as any).config?.password &&
      !(finalFeedConfig as any).config?.encryptedPassword
    ) {
      const existingPassword =
        (existingConfig as any).config?.password ??
        ((existingConfig as any).config?.encryptedPassword?.trim?.()?.length > 0
          ? {
              type: "protected" as const,
              value: (existingConfig as any).config.encryptedPassword,
            }
          : undefined);
      if (existingPassword) {
        (finalFeedConfig as any).config = {
          ...(finalFeedConfig as any).config,
          password: existingPassword,
        };
      }
    }

    // 3. Validate
    const validation = validateFeedConfig(finalFeedConfig as any);
    if (!validation.valid) {
      return ctx.json(
        { errors: validation.errors, warnings: validation.warnings },
        400,
      );
    }

    const yamlStr = yaml.dump(finalFeedConfig);
    await writeFile(configPath, yamlStr, "utf8");

    // Restart worker with updated config
    clearFeedUpdaterInterval(feedId);
    terminateWorker(feedId);
    setFeedUpdaterInterval(finalFeedConfig);

    return ctx.json({
      message: "Feed updated successfully.",
      feedUrls: {
        rss2: `/public/feeds/${feedId}.xml`,
        atom: `/public/feeds/${feedId}.atom`,
        json: `/public/feeds/${feedId}.json`,
      },
      feedId,
      config: maskProtectedValues(finalFeedConfig),
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/feeds/:id/metadata — update metadata fields
  // -------------------------------------------------------------------------

  app.patch("/api/feeds/:id/metadata", async (ctx) => {
    try {
      const id = ctx.req.param("id");
      const body = await ctx.req.json();
      const allowed = ["title", "description", "tags", "category", "favorite"];
      const patch = Object.fromEntries(
        Object.entries(body).filter(([k]) => allowed.includes(k)),
      );
      const updated = await patchMetadata(id, patch);
      return ctx.json(updated);
    } catch (e: any) {
      if (e?.message?.includes("not found"))
        return ctx.json({ error: e.message }, 404);
      if (e?.message?.includes("Invalid feedId"))
        return ctx.json({ error: e.message }, 400);
      return ctx.json({ error: "Internal error" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/feeds/:id/enabled — toggle enabled
  // -------------------------------------------------------------------------

  app.patch("/api/feeds/:id/enabled", async (ctx) => {
    try {
      const id = ctx.req.param("id");
      const { enabled } = await ctx.req.json<{ enabled: boolean }>();
      const updated = await patchEnabled(id, !!enabled);
      return ctx.json(updated);
    } catch (e: any) {
      if (e?.message?.includes("not found"))
        return ctx.json({ error: e.message }, 404);
      if (e?.message?.includes("Invalid feedId"))
        return ctx.json({ error: e.message }, 400);
      return ctx.json({ error: "Internal error" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/feeds/:id/duplicate — duplicate feed
  // -------------------------------------------------------------------------

  app.post("/api/feeds/:id/duplicate", async (ctx) => {
    try {
      const id = ctx.req.param("id");
      const result = await duplicateFeedConfig(id);
      return ctx.json(result, 201);
    } catch (e: any) {
      if (e?.message?.includes("not found"))
        return ctx.json({ error: e.message }, 404);
      if (e?.message?.includes("Invalid feedId"))
        return ctx.json({ error: e.message }, 400);
      return ctx.json({ error: "Internal error" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/feeds/:id/export — export feed config
  // -------------------------------------------------------------------------

  app.get("/api/feeds/:id/export", async (ctx) => {
    try {
      const id = ctx.req.param("id");
      const yamlStr = await exportFeedConfig(id);
      ctx.header("Content-Type", "application/x-yaml");
      ctx.header("Content-Disposition", `attachment; filename="${id}.yaml"`);
      return ctx.body(yamlStr);
    } catch (e: any) {
      if (e?.message?.includes("not found"))
        return ctx.json({ error: e.message }, 404);
      if (e?.message?.includes("Invalid feedId"))
        return ctx.json({ error: e.message }, 400);
      return ctx.json({ error: "Internal error" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/feeds/:id — delete feed
  // -------------------------------------------------------------------------

  app.delete("/api/feeds/:id", async (ctx) => {
    try {
      const id = ctx.req.param("id");
      await deleteFeedConfig(id);
      return ctx.body(null, 204);
    } catch (e: any) {
      if (e?.message?.includes("not found"))
        return ctx.json({ error: e.message }, 404);
      if (e?.message?.includes("Invalid feedId"))
        return ctx.json({ error: e.message }, 400);
      return ctx.json({ error: "Internal error" }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /delete-feed — legacy form-based delete
  // -------------------------------------------------------------------------

  app.post("/delete-feed", async (c) => {
    const data = await c.req.parseBody();
    const feedId = data.feedId;

    if (!feedId) {
      return c.text("Feed name is required.", 400);
    }

    const sanitizedFeedName = basename(feedId as string);
    try {
      await deleteFeedConfig(sanitizedFeedName);
      return c.redirect("/feeds");
    } catch {
      return c.text("Failed to delete feed.", 500);
    }
  });

  // -------------------------------------------------------------------------
  // SPA catch-all routes
  // -------------------------------------------------------------------------

  app.get("/feeds", (ctx) => ctx.html(file("./public/index.html").text()));
  app.get("/feeds/:id/edit", (ctx) =>
    ctx.html(file("./public/index.html").text()),
  );

  return app;
}

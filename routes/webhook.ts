import { Hono } from "hono";
import { readFeedConfig, listFeedConfigs } from "../utilities/config-manager.utility";
import { appendWebhookEvent, buildWebhookItems, normalizeWebhookEvent, validateWebhookPayload, verifyWebhookToken } from "../utilities/webhook-feed.utility";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";
import { writeAllFeedFormats } from "../utilities/feed-output.utility";

export function webhookFeedRouter(deps: { configsDir: string }): Hono {
  const app = new Hono();

  app.post("/webhook-feeds/:slug", async (ctx) => {
    try {
      const slug = ctx.req.param("slug");
      const token = (ctx.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || ctx.req.query("token") || "";
      const configs = await listFeedConfigs(deps.configsDir);
      let feedConfig: any;
      for (const file of configs) {
        const config = await readFeedConfig(file.id, deps.configsDir);
        if ((config as any).feedType === "webhook" && (config as any).webhookFeed?.slug === slug) {
          feedConfig = config;
          break;
        }
      }
      if (!feedConfig) return ctx.json({ ok: false, error: "Webhook feed not found" }, 404);
      if (!verifyWebhookToken(token, feedConfig.webhookFeed.tokenHash)) return ctx.json({ ok: false, error: "Invalid token" }, 401);

      const payload = validateWebhookPayload(await ctx.req.json());
      const event = normalizeWebhookEvent(feedConfig.feedId, payload, feedConfig.webhookFeed);
      const result = await appendWebhookEvent(feedConfig.feedId, event);
      if (!result.duplicate) {
        const events = await import("../utilities/webhook-feed.utility").then((m) => m.readWebhookEvents(feedConfig.feedId));
        const feed = buildFeedFromNormalizedItems({
          feedId: feedConfig.feedId,
          feedName: feedConfig.feedName,
          items: buildWebhookItems(events, feedConfig.webhookFeed),
        });
        await writeAllFeedFormats(feedConfig.feedId, feed);
      }
      return ctx.json({ ok: true, eventId: event.id, duplicate: result.duplicate, feedUrl: `/public/feeds/${feedConfig.feedId}.xml` });
    } catch (err: any) {
      return ctx.json({ ok: false, error: err?.message ?? "Webhook failed" }, 400);
    }
  });

  return app;
}

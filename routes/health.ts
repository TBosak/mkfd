/**
 * Health Routes
 *
 * GET /api/health/runs    — paginated run log query
 * GET /api/health/summary — aggregate health stats
 * GET /api/health/chart/:feedId — chart data for a feed
 * GET /api/health/stream  — SSE stream of live run events
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { EventEmitter } from "node:events";
import { sql, and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getDb } from "../lib/analytics/db";
import * as analyticsSchema from "../lib/analytics/schema";
import type { RunLog } from "../lib/analytics/schema";

export function healthRouter(deps: { runLogEmitter: EventEmitter }): Hono {
  const { runLogEmitter } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/health/runs
  // -------------------------------------------------------------------------

  app.get("/api/health/runs", async (c) => {
    const { feedId, status, feedType, from, to, page = "1", pageSize = "50" } =
      c.req.query();
    const db = drizzle(getDb(), { schema: analyticsSchema });

    const conditions: any[] = [];
    if (feedId) conditions.push(eq(analyticsSchema.runLogs.feedId, feedId));
    if (status) conditions.push(eq(analyticsSchema.runLogs.status, status));
    if (feedType) conditions.push(eq(analyticsSchema.runLogs.feedType, feedType));
    if (from) conditions.push(gte(analyticsSchema.runLogs.startedAt, Number(from)));
    if (to) conditions.push(lte(analyticsSchema.runLogs.startedAt, Number(to)));

    const where = conditions.length ? and(...conditions) : undefined;
    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(analyticsSchema.runLogs)
        .where(where)
        .orderBy(desc(analyticsSchema.runLogs.startedAt))
        .limit(Number(pageSize))
        .offset(offset),
      db
        .select({ count: sql`count(*)` })
        .from(analyticsSchema.runLogs)
        .where(where),
    ]);

    return c.json({ rows, total: Number(countResult[0].count) });
  });

  // -------------------------------------------------------------------------
  // GET /api/health/summary
  // -------------------------------------------------------------------------

  app.get("/api/health/summary", async (c) => {
    const db = drizzle(getDb(), { schema: analyticsSchema });
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const [totalResult, last24hResult, last7dRows, allFeeds] = await Promise.all([
      db.select({ count: sql`count(*)` }).from(analyticsSchema.runLogs),
      db
        .select({ count: sql`count(*)` })
        .from(analyticsSchema.runLogs)
        .where(gte(analyticsSchema.runLogs.startedAt, last24h)),
      db
        .select()
        .from(analyticsSchema.runLogs)
        .where(gte(analyticsSchema.runLogs.startedAt, last7d)),
      db
        .selectDistinct({
          feedId: analyticsSchema.runLogs.feedId,
          feedName: analyticsSchema.runLogs.feedName,
          feedType: analyticsSchema.runLogs.feedType,
        })
        .from(analyticsSchema.runLogs),
    ]);

    const successCount = last7dRows.filter((r) => r.status === "success").length;
    const successRate7d = last7dRows.length
      ? successCount / last7dRows.length
      : 0;
    const durations = last7dRows
      .filter((r) => r.durationMs !== null)
      .map((r) => r.durationMs!);
    const avgDuration7d = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const feedHealth = await Promise.all(
      allFeeds.map(async ({ feedId, feedName, feedType }) => {
        const recent = await db
          .select()
          .from(analyticsSchema.runLogs)
          .where(eq(analyticsSchema.runLogs.feedId, feedId))
          .orderBy(desc(analyticsSchema.runLogs.startedAt))
          .limit(5);
        const last = recent[0];
        const successIn5 = recent.filter((r) => r.status === "success").length;
        const healthStatus =
          recent.length === 0
            ? "green"
            : last.status === "error"
              ? "red"
              : successIn5 < recent.length
                ? "yellow"
                : "green";
        const feedLast7d = last7dRows.filter((r) => r.feedId === feedId);
        const feedSuccessCount = feedLast7d.filter(
          (r) => r.status === "success",
        ).length;
        const feedDurations = feedLast7d
          .filter((r) => r.durationMs !== null)
          .map((r) => r.durationMs!);
        return {
          feedId,
          feedName,
          feedType,
          healthStatus,
          lastRunAt: last?.startedAt ?? null,
          lastHttpStatus: last?.httpStatus ?? null,
          successRate7d: feedLast7d.length
            ? feedSuccessCount / feedLast7d.length
            : 0,
          avgDuration7d: feedDurations.length
            ? feedDurations.reduce((a, b) => a + b, 0) / feedDurations.length
            : 0,
        };
      }),
    );

    return c.json({
      totalRuns: Number(totalResult[0].count),
      last24h: Number(last24hResult[0].count),
      successRate7d,
      avgDuration7d,
      feedHealth,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/health/chart/:feedId
  // -------------------------------------------------------------------------

  app.get("/api/health/chart/:feedId", async (c) => {
    const feedId = c.req.param("feedId");
    const db = drizzle(getDb(), { schema: analyticsSchema });

    const rows = await db
      .select({
        startedAt: analyticsSchema.runLogs.startedAt,
        durationMs: analyticsSchema.runLogs.durationMs,
        itemCount: analyticsSchema.runLogs.itemCount,
        status: analyticsSchema.runLogs.status,
      })
      .from(analyticsSchema.runLogs)
      .where(eq(analyticsSchema.runLogs.feedId, feedId))
      .orderBy(desc(analyticsSchema.runLogs.startedAt))
      .limit(50);

    return c.json({ runs: rows.reverse() });
  });

  // -------------------------------------------------------------------------
  // GET /api/health/stream  (SSE)
  // -------------------------------------------------------------------------

  app.get("/api/health/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const onRun = (row: RunLog) => {
        stream.writeSSE({ data: JSON.stringify(row), event: "run" });
      };
      runLogEmitter.on("run", onRun);

      const ping = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" });
      }, 25000);

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });

      clearInterval(ping);
      runLogEmitter.off("run", onRun);
    });
  });

  return app;
}

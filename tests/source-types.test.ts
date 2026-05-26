import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CalendarFeedConfig } from "../models/calendar.model";
import type { GraphQLFeedConfig } from "../models/graphql.model";
import type { SitemapFeedConfig } from "../models/sitemap.model";
import { parseIcsEvents } from "../utilities/calendar-feed.utility";
import { scanFilesystemFeed, resolveSafeFilesystemPath, matchesGlob } from "../utilities/filesystem-feed.utility";
import { buildGraphQLItems } from "../utilities/graphql-feed.utility";
import { parseSitemapXml, buildSitemapItems } from "../utilities/sitemap.utility";
import { generateWebhookToken, hashWebhookToken, normalizeWebhookEvent, validateWebhookPayload, verifyWebhookToken } from "../utilities/webhook-feed.utility";

describe("Phase 5 source types", () => {
  test("model types compile for sitemap, calendar, and graphql", () => {
    const sitemap: SitemapFeedConfig = {
      inputMode: "exact",
      url: "https://example.com/sitemap.xml",
      mode: "urlList",
      maxItems: 50,
      maxUrlsToScan: 500,
      sortOrder: "lastmodDesc",
      dateStrategy: "lastmodOrFirstSeen",
      titleStrategy: "path",
      descriptionStrategy: "sitemapMetadata",
    };
    const calendar: CalendarFeedConfig = {
      url: "https://example.com/calendar.ics",
      windowDays: 30,
      includePastEvents: false,
      expandRecurringEvents: true,
      maxEvents: 50,
      sortOrder: "startAsc",
      dateStrategy: "start",
      linkStrategy: "eventUrl",
      includeCanceled: false,
    };
    const graphql: GraphQLFeedConfig = {
      endpoint: "https://api.example.com/graphql",
      method: "POST",
      query: "query { posts { nodes { title } } }",
      mapping: { itemPath: "data.posts.nodes", title: "title" },
      pagination: { enabled: false },
    };
    expect([sitemap.mode, calendar.sortOrder, graphql.method]).toEqual(["urlList", "startAsc", "POST"]);
  });

  test("parses sitemap URL entries and maps them to feed items", () => {
    const parsed = parseSitemapXml(`<?xml version="1.0"?><urlset><url><loc>https://example.com/news/hello-world</loc><lastmod>2026-05-20</lastmod></url></urlset>`, "https://example.com/sitemap.xml");
    const items = buildSitemapItems(parsed.entries, {
      inputMode: "exact",
      url: "https://example.com/sitemap.xml",
      mode: "urlList",
      maxItems: 10,
      maxUrlsToScan: 10,
      sortOrder: "lastmodDesc",
      dateStrategy: "lastmodOrFirstSeen",
      titleStrategy: "path",
      descriptionStrategy: "sitemapMetadata",
    });
    expect(items[0]).toMatchObject({ title: "hello world", link: "https://example.com/news/hello-world" });
  });

  test("parses ICS events", () => {
    const events = parseIcsEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:event-1
SUMMARY:Team Meeting
DTSTART:20260520T090000Z
CATEGORIES:work,planning
END:VEVENT
END:VCALENDAR`, {
      windowDays: 365,
      includePastEvents: true,
      expandRecurringEvents: true,
      maxEvents: 10,
      sortOrder: "startAsc",
      includeCanceled: false,
    });
    expect(events[0].summary).toBe("Team Meeting");
    expect(events[0].categories).toEqual(["work", "planning"]);
  });

  test("maps GraphQL structured arrays to normalized feed items", () => {
    const items = buildGraphQLItems({
      data: { posts: { nodes: [{ title: "Hello", url: "https://example.com/hello", publishedAt: "2026-05-20T00:00:00Z" }] } },
    }, {
      endpoint: "https://api.example.com/graphql",
      method: "POST",
      query: "",
      mapping: { itemPath: "data.posts.nodes", title: "title", link: "url", pubDate: "publishedAt" },
    });
    expect(items[0]).toMatchObject({ title: "Hello", link: "https://example.com/hello" });
  });

  test("validates and normalizes webhook payloads", () => {
    const token = generateWebhookToken();
    expect(verifyWebhookToken(token, hashWebhookToken(token))).toBe(true);
    const payload = validateWebhookPayload({ id: "abc", title: "Build finished", severity: "success" });
    const event = normalizeWebhookEvent("feed-1", payload, {
      slug: "builds",
      tokenHash: hashWebhookToken(token),
      maxItems: 50,
      retentionDays: 30,
      duplicateStrategy: "idOrHash",
      dateStrategy: "payloadDateOrReceivedAt",
      storeRawPayload: false,
      mapping: { mode: "native" },
    });
    expect(event.dedupeKey).toBe("abc");
  });

  test("scans filesystem feeds with path confinement and glob filters", async () => {
    const root = resolve("tests/.tmp-filesystem-feed");
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, "agendas"), { recursive: true });
    await writeFile(join(root, "agendas", "notes.md"), "# Meeting Notes", "utf8");
    expect(resolveSafeFilesystemPath(join(root, "agendas"), root)).toBe(join(root, "agendas"));
    expect(matchesGlob("agendas/notes.md", ["*.md"])).toBe(true);
    const result = await scanFilesystemFeed({
      rootPath: join(root, "agendas"),
      recursive: true,
      include: ["*.md"],
      exclude: [],
      maxItems: 10,
      sortOrder: "filenameAsc",
      dateStrategy: "modifiedTime",
      guidStrategy: "path",
      titleStrategy: "filenameWithoutExtension",
      descriptionStrategy: "textPreview",
      extraction: { enabled: true, maxCharacters: 20, maxFileSizeBytes: 1000, supportedExtensions: ["md"] },
    }, root, "filesystem-test");
    expect(result.items[0]).toMatchObject({ title: "notes", relativePath: "notes.md" });
    await rm(root, { recursive: true, force: true });
  });
});

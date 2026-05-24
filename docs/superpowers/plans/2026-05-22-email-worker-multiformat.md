# Email Worker Multi-Format + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email feeds write RSS, Atom, and JSON Feed; history is stored in `items_json` format via the Bun worker's SQLite-backed store; email feeds appear in the health dashboard with real run metrics.

**Architecture:** The Node.js IMAP subprocess stops writing feed files directly. Instead it sends a `feed_ready` JSON message over piped stdout containing the raw feed metadata and items. The Bun worker reconstructs a `Feed` object, calls `writeAllFeedFormats`, stores history, handles webhook delivery, and posts `run_complete`/`run_error` metrics back to `index.ts` for run log insertion.

**Tech Stack:** Bun, Node.js (`--experimental-strip-types`), `feed@5.1.0`, `bun:test`

**Depends on:** Protected Value Encryption and Feed Config Formalization must be executed first for password/config normalization, then Feed Format Refactor (`writeAllFeedFormats`, `extractFeedItemSnapshots`, `storeFeedHistory` with `"items_json"` format). SQLite Runtime Substrate must also be in place because run metrics are inserted into the runtime DB.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `node/imap-watch.utility.ts` | Return `Feed` from builder; add `extractEmailItems`; send `feed_ready` over stdout; remove `handleWebhook`; update password resolution |
| Modify | `workers/imap-feed.worker.ts` | Pipe stdout; read `feed_ready` messages; `handleFeedReady`; `handleEmailWebhook`; post run metrics |
| Modify | `index.ts` | Handle `run_complete`/`run_error` messages; call `insertRunLog` |
| Create | `tests/email-worker.test.ts` | Tests for `extractEmailItems` and `buildRSSFromEmailFolder` return shape |

---

### Task 1: Add extractEmailItems and change buildRSSFromEmailFolder return type

**Files:**
- Modify: `node/imap-watch.utility.ts`
- Create: `tests/email-worker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/email-worker.test.ts
import { describe, it, expect } from "bun:test";
import { Feed } from "feed";

// Import the functions we're about to create/modify.
// buildRSSFromEmailFolder is exported from imap-watch.utility.ts
// We test it with a minimal Email array.
import { buildRSSFromEmailFolder, extractEmailItems } from "../node/imap-watch.utility";
import type { Email } from "../node/imap-watch.utility";

const SAMPLE_CONFIG = {
  id: "http://localhost:5000/public/feeds/test-email.xml",
  title: "Test Email Feed",
  link: "mailto:test@example.com",
  description: "Test email feed",
  copyright: "",
  feedId: "test-email",
  feedName: "Test Email Feed",
  feedType: "email",
  config: { folder: "INBOX", emailCount: 10 },
};

const SAMPLE_EMAIL: Email = {
  UID: 1,
  messageId: "<test@example.com>",
  subject: "Test Subject",
  from: "sender@example.com",
  date: "2026-01-01T00:00:00.000Z",
  textBody: "Hello world",
};

describe("buildRSSFromEmailFolder", () => {
  it("returns a Feed instance (not a string)", () => {
    const result = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(result.feed).toBeInstanceOf(Feed);
  });

  it("returns a commit function", () => {
    const result = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(typeof result.commit).toBe("function");
  });

  it("Feed object produces valid RSS 2.0", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    const rss = feed.rss2();
    expect(rss).toContain("<rss");
    expect(rss).toContain("Test Subject");
  });

  it("Feed object produces valid Atom", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    expect(feed.atom1()).toContain("<feed");
  });
});

describe("extractEmailItems", () => {
  it("maps feed items to message shape with ISO date strings", () => {
    const { feed } = buildRSSFromEmailFolder([SAMPLE_EMAIL], SAMPLE_CONFIG as any);
    const items = extractEmailItems(feed);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("<test@example.com>");
    expect(typeof items[0].date).toBe("string");
    expect(() => new Date(items[0].date)).not.toThrow();
  });

  it("returns empty array for empty feed", () => {
    const { feed } = buildRSSFromEmailFolder([], SAMPLE_CONFIG as any);
    expect(extractEmailItems(feed)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/email-worker.test.ts
```

Expected: FAIL — `buildRSSFromEmailFolder` returns `{ xml, commit }`, not `{ feed, commit }`; `extractEmailItems` not exported

- [ ] **Step 3: Change buildRSSFromEmailFolder return type in imap-watch.utility.ts**

Find the `BuildRSSResult` interface (around line 681) and the `buildRSSFromEmailFolder` function (around line 689). 

Change `BuildRSSResult`:

```typescript
export interface BuildRSSResult {
  feed: Feed;
  commit: () => void;
}
```

Find the end of `buildRSSFromEmailFolder` (around line 843) where the function returns:

```typescript
return { xml: feed.rss2(), commit };
```

Replace with:

```typescript
return { feed, commit };
```

- [ ] **Step 4: Add extractEmailItems function**

Add after `buildRSSFromEmailFolder`:

```typescript
export type EmailFeedItemMessage = {
  title: string;
  id: string;
  link: string;
  date: string;
  description?: string;
  content?: string;
  author?: Array<{ name?: string; email?: string; link?: string }>;
  category?: Array<{ name?: string }>;
  enclosure?: { url: string; type?: string; length?: number };
};

export function extractEmailItems(feed: Feed): EmailFeedItemMessage[] {
  return feed.items.map((item) => ({
    title:       item.title ?? "",
    id:          item.id ?? "",
    link:        item.link ?? "",
    date:        (item.date ?? new Date()).toISOString(),
    description: item.description ?? undefined,
    content:     item.content ?? undefined,
    author:      item.author as EmailFeedItemMessage["author"],
    category:    item.category as EmailFeedItemMessage["category"],
    enclosure:   item.enclosure as EmailFeedItemMessage["enclosure"],
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/email-worker.test.ts
```

Expected: PASS

- [ ] **Step 6: Run all tests to confirm no regressions**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add node/imap-watch.utility.ts tests/email-worker.test.ts
git commit -m "feat: buildRSSFromEmailFolder returns Feed object; add extractEmailItems"
```

---

### Task 2: Update password resolution in imap-watch.utility.ts

**Files:**
- Modify: `node/imap-watch.utility.ts`

- [ ] **Step 1: Find the password resolution block**

```bash
grep -n "encryptedPassword\|password\|decrypt" /home/timb/projects/mkfd/node/imap-watch.utility.ts | head -15
```

- [ ] **Step 2: Replace the password resolution block**

Find the `imapOriginalConfig` assignment (around line 163):

```typescript
const imapOriginalConfig = {
  host: rawConfig.config?.host,
  port: rawConfig.config?.port,
  user: rawConfig.config?.user,
  password: rawConfig.config?.encryptedPassword ? decrypt(rawConfig.config.encryptedPassword, encryptionKey) : undefined,
  folder: rawConfig.config?.folder || "INBOX",
  emailCount: rawConfig.config?.emailCount || 10,
};
```

Replace the `password` field resolution with:

```typescript
function resolveEmailPassword(config: any, key: string): string | undefined {
  const raw = config?.password ?? config?.encryptedPassword;
  if (!raw) return undefined;

  // ProtectedValue: { type: "protected", value: "<ciphertext>" }
  if (typeof raw === "object" && raw.type === "protected") {
    try { return decrypt(raw.value, key); } catch { return undefined; }
  }

  // ProtectedValue: { type: "env", value: "VAR_NAME", prefix?: "..." }
  if (typeof raw === "object" && raw.type === "env") {
    const resolved = process.env[raw.value];
    if (!resolved) {
      console.error(`[IMAP] Missing environment variable: ${raw.value}`);
      return undefined;
    }
    return `${raw.prefix ?? ""}${resolved}`;
  }

  // Legacy encryptedPassword: raw base64 ciphertext string
  if (typeof raw === "string") {
    try { return decrypt(raw, key); } catch { return undefined; }
  }

  return undefined;
}

const imapOriginalConfig = {
  host:        rawConfig.config?.host,
  port:        rawConfig.config?.port,
  user:        rawConfig.config?.user,
  password:    resolveEmailPassword(rawConfig.config, encryptionKey),
  folder:      rawConfig.config?.folder || "INBOX",
  emailCount:  rawConfig.config?.emailCount || 10,
};
```

- [ ] **Step 3: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add node/imap-watch.utility.ts
git commit -m "feat: email worker resolves ProtectedValue passwords (protected + env) with legacy fallback"
```

---

### Task 3: Replace feed file writes with stdout messages in imap-watch.utility.ts

**Files:**
- Modify: `node/imap-watch.utility.ts`

- [ ] **Step 1: Add the EmailFeedMessage type**

Add near the top of the file, after the existing type definitions:

```typescript
export interface EmailFeedMessage {
  type: "feed_ready";
  feedId: string;
  feedMeta: {
    id: string;
    title: string;
    link: string;
    description: string;
    language?: string;
    copyright?: string;
    generator?: string;
    image?: string;
    ttl?: number;
    updated: string;
  };
  items: EmailFeedItemMessage[];
  webhookConfig?: {
    enabled: boolean;
    url?: string;
    format?: "xml" | "json";
    newItemsOnly?: boolean;
  };
}
```

- [ ] **Step 2: Add a sendFeedReady helper**

Add before the `ImapWatcher` class:

```typescript
function sendFeedReady(feed: Feed, config: RSSFeedOptions): void {
  const message: EmailFeedMessage = {
    type: "feed_ready",
    feedId: config.feedId!,
    feedMeta: {
      id:          config.id,
      title:       config.title || config.feedName || "Email Feed",
      link:        config.link || config.id,
      description: config.description || "",
      language:    config.language,
      copyright:   config.copyright,
      generator:   config.generator,
      image:       config.image,
      ttl:         config.ttl,
      updated:     new Date().toISOString(),
    },
    items: extractEmailItems(feed),
    webhookConfig: config.webhook ? {
      enabled:      config.webhook.enabled,
      url:          config.webhook.url,
      format:       config.webhook.format,
      newItemsOnly: config.webhook.newItemsOnly,
    } : undefined,
  };
  process.stdout.write(JSON.stringify(message) + "\n");
}
```

- [ ] **Step 3: Replace writeFileSync in fetchRecentStartupEmails**

Find the section in `fetchRecentStartupEmails` (around line 334–339):

```typescript
const { xml: rss, commit } = buildRSSFromEmailFolder(emails, this.config);
writeFileSync(
  path.join(__dirname, "../public/feeds", `${this.config.feedId}.xml`),
  rss,
);
commit();
console.log("[IMAP] RSS Feed generated");
```

Replace with:

```typescript
const { feed, commit } = buildRSSFromEmailFolder(emails, this.config);
sendFeedReady(feed, this.config);
commit();
console.log("[IMAP] Feed data sent to Bun worker");
```

- [ ] **Step 4: Replace writeFileSync in fetchNewEmails**

Find the section in `fetchNewEmails` (around line 442–456):

```typescript
const { xml: rss, commit } = buildRSSFromEmailFolder(emails, this.config);
writeFileSync(
  path.join(__dirname, "../public/feeds", `${this.config.feedId}.xml`),
  rss,
);
commit();
console.log(`[IMAP] RSS Feed regenerated for feed ${this.config.feedId}`);

// Handle webhook if configured
if (this.config.webhook?.enabled && this.config.webhook?.url) {
  console.log(`[IMAP] Calling webhook handler for feed ${this.config.feedId}`);
  this.handleWebhook(rss);
} else {
  console.log(`[IMAP] Webhook not configured ...`);
}
```

Replace with:

```typescript
const { feed, commit } = buildRSSFromEmailFolder(emails, this.config);
sendFeedReady(feed, this.config);
commit();
console.log(`[IMAP] Feed data sent to Bun worker for feed ${this.config.feedId}`);
```

- [ ] **Step 5: Remove the handleWebhook method**

Delete the entire `private async handleWebhook(rssXml: string): Promise<void>` method (lines ~482–570). Webhook delivery is now the Bun worker's responsibility.

- [ ] **Step 6: Guard module-level startup code with `import.meta.main`**

`imap-watch.utility.ts` calls `process.exit(1)` at the top level if `encryptionKey`/`configHash` are missing. When tests import the file, this fires immediately. Wrap everything from `if (!encryptionKey || !configHash)` down to `watcher.start()` in a guard:

```typescript
if (import.meta.main) {
  if (!encryptionKey || !configHash) {
    console.error(
      "[IMAP Node Watcher] Usage: node imap-watcher.service.ts --key=<encryptionKey> --hash=<configHash>",
    );
    process.exit(1);
  }

  // ... all existing startup code: loading YAML, creating completeFeedConfig, new ImapWatcher(), watcher.start()
}
```

- [ ] **Step 7: Run all tests to verify no process.exit on import**

```bash
bun test tests/email-worker.test.ts
```

Expected: PASS — no exit, tests run cleanly

- [ ] **Step 8: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add node/imap-watch.utility.ts
git commit -m "feat: email subprocess sends feed_ready message over stdout; guard startup logic with import.meta.main"
```

---

### Task 4: Update imap-feed.worker.ts — pipe stdout, handleFeedReady, run metrics

**Files:**
- Modify: `workers/imap-feed.worker.ts`

- [ ] **Step 1: Add imports at the top of imap-feed.worker.ts**

```typescript
import {
  writeAllFeedFormats,
  extractFeedItemSnapshots,
  serializeAllFeedFormats,
} from "../utilities/feed-output.utility";
import { storeFeedHistory } from "../utilities/feed-history.utility";
import { Feed } from "feed";
import type { EmailFeedMessage } from "../node/imap-watch.utility";
```

- [ ] **Step 2: Change stdout from "inherit" to "pipe"**

Find the `spawn` call (around line 25):

```typescript
childProcess = spawn({
  cmd: ["node", "--experimental-strip-types", "./node/imap-watch.utility.ts", ...],
  stdout: "inherit",
  stderr: "inherit",
  env: { ... },
});
```

Change `stdout: "inherit"` to `stdout: "pipe"`.

- [ ] **Step 3: Add handleEmailWebhook function**

Add before `self.onmessage`:

```typescript
async function handleEmailWebhook(
  feedId: string,
  feed: Feed,
  webhookConfig: NonNullable<EmailFeedMessage["webhookConfig"]>,
): Promise<void> {
  const { sendWebhook, createWebhookPayload, createJsonWebhookPayload } =
    await import("../utilities/webhook.utility");
  const { getPreviousFeedHistory } = await import("../utilities/feed-history.utility");

  let shouldDeliver = true;

  if (webhookConfig.newItemsOnly) {
    const previousData = await getPreviousFeedHistory(feedId);
    if (previousData) {
      try {
        const prevSnapshots = JSON.parse(previousData) as Array<{ guid?: string }>;
        const prevGuids = new Set(prevSnapshots.map((s) => s.guid).filter(Boolean));
        const currentSnapshots = extractFeedItemSnapshots(feed);
        const newItemCount = currentSnapshots.filter(
          (s) => s.guid && !prevGuids.has(s.guid),
        ).length;
        shouldDeliver = newItemCount > 0;
      } catch {
        // Malformed snapshot — deliver anyway
      }
    }
  }

  if (shouldDeliver) {
    const outputs = serializeAllFeedFormats(feed);
    const payload =
      webhookConfig.format === "json"
        ? createJsonWebhookPayload({ feedId, webhook: webhookConfig }, outputs.rss2, "automatic")
        : createWebhookPayload({ feedId, webhook: webhookConfig }, outputs.rss2, "automatic");
    await sendWebhook(webhookConfig, payload);
  }
}
```

- [ ] **Step 4: Add handleFeedReady function**

Add after `handleEmailWebhook`:

```typescript
async function handleFeedReady(
  msg: EmailFeedMessage,
  feedConfig: any,
): Promise<void> {
  const startedAt = Date.now();
  let webhookStatus: string | null = null;
  let webhookError: string | null = null;

  try {
    const feed = new Feed({
      ...msg.feedMeta,
      updated: new Date(msg.feedMeta.updated),
    });

    for (const item of msg.items) {
      feed.addItem({
        ...item,
        date: new Date(item.date),
      });
    }

    await writeAllFeedFormats(msg.feedId, feed);

    const snapshots = extractFeedItemSnapshots(feed);
    await storeFeedHistory(msg.feedId, JSON.stringify(snapshots), "items_json");

    const webhook = msg.webhookConfig ?? feedConfig?.webhook;
    if (webhook?.enabled && webhook?.url) {
      try {
        await handleEmailWebhook(msg.feedId, feed, webhook);
        webhookStatus = "success";
      } catch (err: any) {
        webhookStatus = "error";
        webhookError = err.message ?? "Unknown webhook error";
      }
    }

    self.postMessage({
      status: "run_complete",
      feedId: msg.feedId,
      metrics: {
        startedAt,
        durationMs:   Date.now() - startedAt,
        itemCount:    msg.items.length,
        webhookStatus,
        webhookError,
      },
    });
  } catch (err: any) {
    self.postMessage({
      status: "run_error",
      feedId: msg.feedId,
      metrics: {
        startedAt,
        durationMs:   Date.now() - startedAt,
        errorMessage: err.message ?? "Unknown error in handleFeedReady",
      },
    });
  }
}
```

- [ ] **Step 5: Add stdout reader after the spawn call**

After `childProcess = spawn(...)`, add the reader (capture `feedConfig` from the message first):

```typescript
const feedConfig = message.data.config;

(async () => {
  if (!childProcess.stdout) return;
  const reader = (childProcess.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as EmailFeedMessage;
          if (msg.type === "feed_ready") {
            await handleFeedReady(msg, feedConfig);
          }
        } catch {
          // Not JSON — subprocess console.log output, ignore
        }
      }
    }
  } catch {
    // Stream closed — subprocess exited
  }
})();
```

- [ ] **Step 6: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add workers/imap-feed.worker.ts
git commit -m "feat: imap Bun worker pipes stdout, handles feed_ready, writes all three formats, posts run metrics"
```

---

### Task 5: Handle run_complete and run_error in index.ts

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Find the email worker onmessage handler**

```bash
grep -n "imap\|IMAP\|email\|run_complete\|run_error\|insertRunLog" /home/timb/projects/mkfd/index.ts | grep -v "^#" | head -20
```

- [ ] **Step 2: Locate where the email Bun worker's messages are handled**

The email worker's messages come through `feedUpdaters.get(feedConfig.feedId).onmessage`. Find the handler that processes `done` / `error` status messages from the email worker (look for `message.data.status === "done"` or similar).

- [ ] **Step 3: Add run_complete and run_error handling**

In the `onmessage` handler for the email worker, add after the existing `done`/`error` handling:

```typescript
if (message.data.status === "run_complete") {
  try {
    const sqlite = getDb();
    await insertRunLog(sqlite, {
      feedId:          feedConfig.feedId,
      feedName:        feedConfig.feedName,
      feedType:        feedConfig.feedType,
      startedAt:       message.data.metrics.startedAt,
      durationMs:      message.data.metrics.durationMs,
      status:          "success",
      errorMessage:    null,
      httpStatus:      null,
      timedOut:        false,
      itemCount:       message.data.metrics.itemCount ?? null,
      selectorMatches: null,
      dateFallbacks:   0,
      duplicateGuids:  0,
      webhookStatus:   message.data.metrics.webhookStatus ?? null,
      webhookError:    message.data.metrics.webhookError ?? null,
    });
  } catch (logErr) {
    console.error("[IMAP] Failed to insert run log:", logErr);
  }
}

if (message.data.status === "run_error") {
  try {
    const sqlite = getDb();
    await insertRunLog(sqlite, {
      feedId:          feedConfig.feedId,
      feedName:        feedConfig.feedName,
      feedType:        feedConfig.feedType,
      startedAt:       message.data.metrics.startedAt,
      durationMs:      message.data.metrics.durationMs,
      status:          "error",
      errorMessage:    message.data.metrics.errorMessage ?? "Unknown error",
      httpStatus:      null,
      timedOut:        false,
      itemCount:       null,
      selectorMatches: null,
      dateFallbacks:   0,
      duplicateGuids:  0,
      webhookStatus:   null,
      webhookError:    null,
    });
  } catch (logErr) {
    console.error("[IMAP] Failed to insert run log:", logErr);
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
bun test tests/
```

Expected: All pass

- [ ] **Step 5: Start the dev server and verify the email worker starts without crashing**

```bash
bun run dev
```

Confirm the app starts without errors. The email worker will only activate when an email feed config exists in `./configs/`. If you have one, confirm:
1. No crash on startup
2. The health dashboard shows the email feed
3. After emails are processed, run log entries appear for the email feed

Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: index.ts logs run_complete and run_error metrics from email worker to health dashboard"
```

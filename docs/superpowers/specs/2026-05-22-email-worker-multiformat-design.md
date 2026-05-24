# Email Worker Multi-Format + History — Design Spec

**Date:** 2026-05-22
**Tier:** R2 Output & Operations
**Status:** Approved

---

## Goal

The email worker (`imap-watch.utility.ts`) currently writes only a single `.xml` file and handles feed history and webhook delivery itself in Node.js. This spec moves feed file writing, history storage, and webhook delivery to the Bun worker layer (`imap-feed.worker.ts`) so email feeds benefit from the same multi-format output, SQLite-backed history, and GUID-based webhook detection as every other feed type.

---

## Scope

### In scope

- `imap-feed.worker.ts` — change subprocess `stdout` to `"pipe"`; add stdout message reader; reconstruct `Feed` object; call `writeAllFeedFormats`, `storeFeedHistory`; handle webhook delivery; post `run_complete`/`run_error` metrics back to main process after each batch
- `node/imap-watch.utility.ts` — remove direct feed file writes; send `feed_ready` message over stdout; define `EmailFeedMessage` type; call `commit()` after sending
- `index.ts` — handle `run_complete` and `run_error` messages from the email Bun worker; call `insertRunLog` with real item count, duration, and webhook outcome
- Password resolution in Node.js subprocess updated to support both `config.password` (ProtectedValue) and legacy `config.encryptedPassword`

### Out of scope

- Item hash tracking (`loadDateIndex`/`saveDateIndex`) for email feeds — not needed; email items have reliable Message-ID GUIDs; the IMAP protocol handles new-item detection natively
- Node.js SQLite access — solved by moving all persistence to the Bun worker
- Per-item HTML file writing — stays in Node.js, uses `writeFileSync`, no change needed
- Changes to the IMAP connection, email parsing, or `buildRSSFromEmailFolder` feed construction logic

---

## Architecture

The communication between the Node.js subprocess and the Bun worker changes from "subprocess writes files and exits" to a **message-passing protocol over piped stdout**:

```
Node.js subprocess (imap-watch.utility.ts)
  ↓ fetchRecentStartupEmails / fetchNewEmails
  ↓ buildRSSFromEmailFolder → Feed object
  ↓ write per-item HTML pages (writeFileSync — unchanged)
  ↓ commit() — prune stale HTML pages
  ↓ process.stdout.write(JSON.stringify(feedReadyMessage) + "\n")

Bun worker (imap-feed.worker.ts)
  ↑ reads stdout line
  ↓ parse EmailFeedMessage
  ↓ reconstruct Feed object (new Feed(feedMeta) + items)
  ↓ writeAllFeedFormats(feedId, feed)        ← Bun.write, SQLite-backed
  ↓ storeFeedHistory(feedId, itemsJson)      ← items_json format, SQLite-backed
  ↓ webhook detection + delivery             ← GUID comparison
```

The subprocess spawn call changes from `stdout: "inherit"` to `stdout: "pipe"`. `stderr` stays `"inherit"` so logs still print to the terminal.

---

## Message Protocol

### `EmailFeedMessage` type

Defined in `node/imap-watch.utility.ts` and mirrored in `workers/imap-feed.worker.ts`:

```ts
type EmailFeedMessage = {
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
    updated: string; // ISO string — new Date(updated) on Bun side
  };
  items: Array<{
    title: string;
    id: string;
    link: string;
    date: string; // ISO string — new Date(date) on Bun side
    description?: string;
    content?: string;
    author?: Array<{ name?: string; email?: string; link?: string }>;
    category?: Array<{ name?: string }>;
    enclosure?: { url: string; type?: string; length?: number };
  }>;
  webhookConfig?: {
    enabled: boolean;
    url?: string;
    format?: "xml" | "json";
    newItemsOnly?: boolean;
  };
};
```

Messages are newline-delimited JSON written to `process.stdout`. One message per email batch.

---

## Node.js Subprocess Changes (`node/imap-watch.utility.ts`)

### Feed message sending

Replace both `writeFileSync` feed file calls (in `fetchRecentStartupEmails` and `fetchNewEmails`) with:

```ts
const { xml: _xml, commit } = buildRSSFromEmailFolder(emails, this.config);

// Send feed data to Bun worker for multi-format writing and history storage
const message: EmailFeedMessage = {
  type: "feed_ready",
  feedId: this.config.feedId,
  feedMeta: {
    id: this.config.id,
    title: this.config.title,
    link: this.config.link,
    description: this.config.description,
    language: this.config.language,
    copyright: this.config.copyright,
    generator: this.config.generator,
    image: this.config.image,
    ttl: this.config.ttl,
    updated: new Date().toISOString(),
  },
  items: extractEmailItems(feed),
  webhookConfig: this.config.webhook,
};
process.stdout.write(JSON.stringify(message) + "\n");
commit(); // safe to call here — only prunes stale HTML files for this feed
```

`buildRSSFromEmailFolder` is modified to return `{ feed: Feed, commit: () => void }` instead of `{ xml: string, commit: () => void }` — the call site changes from `const { xml: _xml, commit }` to `const { feed, commit }`.

`extractEmailItems` maps `feed.items` to the message's `items` array shape, converting `Date` objects to ISO strings:

```ts
function extractEmailItems(feed: Feed): EmailFeedMessage["items"] {
  return feed.items.map((item) => ({
    title:       item.title ?? "",
    id:          item.id ?? "",
    link:        item.link ?? "",
    date:        (item.date ?? new Date()).toISOString(),
    description: item.description,
    content:     item.content,
    author:      item.author,
    category:    item.category,
    enclosure:   item.enclosure as EmailFeedMessage["items"][0]["enclosure"],
  }));
}
```

### `handleWebhook` method

Removed entirely — webhook delivery is now the Bun worker's responsibility.

### Password resolution

Updated to support `ProtectedValue` format (from Feed Config Formalization plan) with fallback to legacy `encryptedPassword`:

```ts
import { decrypt } from "../utilities/security.utility.ts";
import { isProtectedValue } from "../utilities/protected-values.utility.ts";

const rawPassword = rawConfig.config?.password ?? rawConfig.config?.encryptedPassword;
let password: string | undefined;

if (isProtectedValue(rawPassword)) {
  // env type
  if (rawPassword.type === "env") {
    const resolved = process.env[rawPassword.value];
    password = resolved ? `${rawPassword.prefix ?? ""}${resolved}` : undefined;
  } else {
    // protected type — decrypt
    password = decrypt(rawPassword.value, encryptionKey);
  }
} else if (typeof rawPassword === "string") {
  // legacy encryptedPassword — raw base64 ciphertext
  password = decrypt(rawPassword, encryptionKey);
}
```

---

## Bun Worker Changes (`workers/imap-feed.worker.ts`)

### Spawn with piped stdout

```ts
childProcess = spawn({
  cmd: ["node", "--experimental-strip-types", "./node/imap-watch.utility.ts", ...],
  stdout: "pipe",   // changed from "inherit"
  stderr: "inherit",
  env: { ... },
});
```

### Stdout reader

After spawning, read newline-delimited JSON from `childProcess.stdout`. The feed config from the original `start` message is captured in a closure:

```ts
import { writeAllFeedFormats, extractFeedItemSnapshots, serializeAllFeedFormats } from "../utilities/feed-output.utility";
import { storeFeedHistory } from "../utilities/feed-history.utility";
import { Feed } from "feed";

// Capture feedConfig from the start message before entering async scope
const feedConfig = message.data.config;

(async () => {
  const reader = childProcess.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        // Not JSON — ignore (console.log output from the subprocess)
      }
    }
  }
})();
```

### `handleFeedReady`

```ts
async function handleFeedReady(msg: EmailFeedMessage, feedConfig: any): Promise<void> {
  const startedAt = Date.now();
  let webhookStatus: string | null = null;
  let webhookError: string | null = null;

  try {
    // 1. Reconstruct Feed object
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

    // 2. Write all three formats
    await writeAllFeedFormats(msg.feedId, feed);

    // 3. Store format-agnostic snapshot
    const snapshots = extractFeedItemSnapshots(feed);
    await storeFeedHistory(
      msg.feedId,
      JSON.stringify(snapshots),
      "items_json",
    );

    // 4. Webhook delivery (if configured)
    const webhook = msg.webhookConfig ?? feedConfig.webhook;
    if (webhook?.enabled && webhook?.url) {
      try {
        await handleEmailWebhook(msg.feedId, feed, webhook);
        webhookStatus = "success";
      } catch (err: any) {
        webhookStatus = "error";
        webhookError = err.message;
      }
    }

    // 5. Post run metrics back to main process
    self.postMessage({
      status: "run_complete",
      feedId: msg.feedId,
      metrics: {
        startedAt,
        durationMs: Date.now() - startedAt,
        itemCount: msg.items.length,
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
        durationMs: Date.now() - startedAt,
        errorMessage: err.message,
      },
    });
  }
}
```

### Webhook delivery

```ts
async function handleEmailWebhook(
  feedId: string,
  feed: Feed,
  webhookConfig: EmailFeedMessage["webhookConfig"],
): Promise<void> {
  const { sendWebhook, createWebhookPayload, createJsonWebhookPayload } =
    await import("../utilities/webhook.utility");
  const { getPreviousFeedHistory } = await import("../utilities/feed-history.utility");
  const { isProtectedValue } = await import("../utilities/protected-values.utility");

  let shouldDeliver = true;

  if (webhookConfig.newItemsOnly) {
    const previousData = await getPreviousFeedHistory(feedId);
    if (previousData) {
      try {
        // Previous snapshot is items_json format
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

---

## index.ts — Run Log Handling

The existing `feedUpdaters.get(feedConfig.feedId).onmessage` handler in `index.ts` already handles `done` and `error` messages from the email Bun worker. Extend it to handle the new `run_complete` and `run_error` messages:

```ts
if (message.data.status === "run_complete") {
  await insertRunLog(getDb(), {
    feedId:          feedConfig.feedId,
    feedName:        feedConfig.feedName,
    feedType:        feedConfig.feedType,
    startedAt:       message.data.metrics.startedAt,
    durationMs:      message.data.metrics.durationMs,
    status:          "success",
    errorMessage:    null,
    httpStatus:      null,
    timedOut:        false,
    itemCount:       message.data.metrics.itemCount,
    selectorMatches: null,
    dateFallbacks:   0,
    duplicateGuids:  0,
    webhookStatus:   message.data.metrics.webhookStatus,
    webhookError:    message.data.metrics.webhookError,
  });
}

if (message.data.status === "run_error") {
  await insertRunLog(getDb(), {
    feedId:          feedConfig.feedId,
    feedName:        feedConfig.feedName,
    feedType:        feedConfig.feedType,
    startedAt:       message.data.metrics.startedAt,
    durationMs:      message.data.metrics.durationMs,
    status:          "error",
    errorMessage:    message.data.metrics.errorMessage,
    httpStatus:      null,
    timedOut:        false,
    itemCount:       null,
    selectorMatches: null,
    dateFallbacks:   0,
    duplicateGuids:  0,
    webhookStatus:   null,
    webhookError:    null,
  });
}
```

One run log entry is inserted per email batch — both the startup fetch and each subsequent new-email event produce an entry. This makes email feeds visible in the health dashboard alongside web scraping and API feeds.

---

## What This Spec Does Not Cover

- Item hash tracking for email — not needed (Message-ID GUIDs are unique by RFC; IMAP handles new-item detection)
- Node.js SQLite access — eliminated by moving persistence to Bun worker
- Per-item HTML file writing — unchanged in Node.js
- IMAP connection logic, email parsing, or `buildRSSFromEmailFolder` feed item construction

declare var self: Worker;

import { spawn } from "bun";
import { writeAllFeedFormats, extractFeedItemSnapshots, serializeAllFeedFormats } from "../utilities/feed-output.utility";
import { storeFeedHistory } from "../utilities/feed-history.utility";
import { Feed } from "feed";
import type { EmailFeedMessage, EmailItemSnapshot } from "../node/imap-watch.utility";

let childProcess: any = null;

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

self.onmessage = (message) => {
  if (message.data.command === "start" && !childProcess) {
    const encryptionKey = message.data.encryptionKey;
    const configHash = message.data.config.feedId;
    let startedAt = Date.now();

    if (!encryptionKey || typeof encryptionKey !== "string") {
      console.error("[IMAP WORKER] Invalid encryption key:", encryptionKey);
      self.postMessage({ status: "error", error: "Invalid encryption key" });
      return;
    }

    console.log("[IMAP WORKER] Spawning Node IMAP watcher subprocess...");

    // Set default memory allocation if not already configured by user
    const nodeOptions = process.env.NODE_OPTIONS || "--max-old-space-size=4096";
    console.log(`[IMAP WORKER] Using NODE_OPTIONS: ${nodeOptions}`);

    childProcess = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "./node/imap-watch.utility.ts",
        `--key=${encryptionKey}`,
        `--hash=${configHash}`,
      ],
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
    });

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

    childProcess.onexit = (exitCode) => {
      console.log(
        "[IMAP WORKER] Node IMAP process exited with code:",
        exitCode,
      );
      const durationMs = Date.now() - startedAt;
      self.postMessage({
        status: exitCode === 0 ? "done" : "error",
        feedId: message.data.config.feedId,
        metrics: {
          startedAt,
          durationMs,
          httpStatus: null,
          timedOut: false,
          itemCount: null,
          selectorMatches: null,
          dateFallbacks: 0,
          duplicateGuids: 0,
          webhookStatus: null,
          webhookError: null,
          errorMessage: exitCode !== 0 ? `IMAP subprocess exited with code ${exitCode}` : null,
        },
      });
      childProcess = null;
    };

    self.postMessage({ status: "IMAP worker started." });
  } else if (message.data.command === "stop" && childProcess) {
    console.log("[IMAP WORKER] Stopping Node IMAP watcher...");
    childProcess.kill();
    childProcess = null;
    self.postMessage({ status: "IMAP worker stopped." });
  }
};

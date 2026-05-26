/**
 * Worker Manager Utility
 *
 * Module-level singleton that manages feed worker lifecycle:
 * creation, interval scheduling, termination, and startup processing.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { EventEmitter } from "node:events";
import { insertRunLog, pruneRunLogs, getDb } from "../lib/analytics/db";
import { getEffectiveSettings } from "./app-settings.utility";

// ---------------------------------------------------------------------------
// Module-level state (singleton)
// ---------------------------------------------------------------------------

let _encryptionKey = "";
let _runLogEmitter: EventEmitter = new EventEmitter();

const feedUpdaters: Map<string, Worker> = new Map();
const feedIntervals: Map<string, Timer> = new Map();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export interface WorkerManagerDeps {
  encryptionKey: string;
  runLogEmitter: EventEmitter;
}

export function initWorkerManager(deps: WorkerManagerDeps): void {
  _encryptionKey = deps.encryptionKey;
  _runLogEmitter = deps.runLogEmitter;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function insertAndEmitRunLog(feedConfig: any, data: {
  startedAt: number;
  durationMs: number | null;
  status: "success" | "error";
  errorMessage: string | null;
  httpStatus: number | null;
  timedOut: boolean;
  itemCount: number | null;
  selectorMatches: number | null;
  dateFallbacks: number;
  duplicateGuids: number;
  webhookStatus: string | null;
  webhookError: string | null;
}): Promise<void> {
  try {
    const sqlite = getDb();
    const row = await insertRunLog(sqlite, {
      feedId: feedConfig.feedId,
      feedName: feedConfig.feedName ?? feedConfig.config?.title ?? feedConfig.feedId,
      feedType: feedConfig.feedType,
      ...data,
    });
    _runLogEmitter.emit("run", row);
    const effectiveSettings = await getEffectiveSettings(sqlite);
    await pruneRunLogs(sqlite, feedConfig.feedId, {
      retentionDays: effectiveSettings.retention_days.value as number,
      retentionDaysEnabled: effectiveSettings.retention_days_enabled.value as boolean,
      retentionRuns: effectiveSettings.retention_runs.value as number,
      retentionRunsEnabled: effectiveSettings.retention_runs_enabled.value as boolean,
    });
  } catch (e) {
    console.error("[Analytics] Failed to log run:", e);
  }
}

// ---------------------------------------------------------------------------
// initializeWorker
// ---------------------------------------------------------------------------

export function initializeWorker(feedConfig: any): void {
  feedUpdaters.set(
    feedConfig.feedId,
    new Worker(
      feedConfig.feedType === "email"
        ? "./workers/imap-feed.worker.ts"
        : "./workers/feed-updater.worker.ts",
      { type: "module" },
    ),
  );

  const worker = feedUpdaters.get(feedConfig.feedId)!;

  worker.onmessage = async (message) => {
    // -----------------------------------------------------------------------
    // done / error — web scraping / rest workers
    // -----------------------------------------------------------------------
    if (message.data.status === "done" || message.data.status === "error") {
      console.log(
        message.data.status === "done"
          ? `Feed updates completed for ${feedConfig.feedId}.`
          : `Feed updates for ${feedConfig.feedId} encountered an error: ${message.data.metrics?.errorMessage}`,
      );
      const metrics = message.data.metrics ?? {};
      await insertAndEmitRunLog(feedConfig, {
        startedAt: metrics.startedAt ?? Date.now(),
        durationMs: metrics.durationMs ?? null,
        status: message.data.status === "done" ? "success" : "error",
        errorMessage: metrics.errorMessage ?? null,
        httpStatus: metrics.httpStatus ?? null,
        timedOut: metrics.timedOut ?? false,
        itemCount: metrics.itemCount ?? null,
        selectorMatches: metrics.selectorMatches ?? null,
        dateFallbacks: metrics.dateFallbacks ?? 0,
        duplicateGuids: metrics.duplicateGuids ?? 0,
        webhookStatus: metrics.webhookStatus ?? null,
        webhookError: metrics.webhookError ?? null,
      });
    }

    // -----------------------------------------------------------------------
    // run_complete — IMAP / email workers
    // -----------------------------------------------------------------------
    if (message.data.status === "run_complete") {
      await insertAndEmitRunLog(feedConfig, {
        startedAt: message.data.metrics.startedAt,
        durationMs: message.data.metrics.durationMs,
        status: "success",
        errorMessage: null,
        httpStatus: null,
        timedOut: false,
        itemCount: message.data.metrics.itemCount ?? null,
        selectorMatches: null,
        dateFallbacks: 0,
        duplicateGuids: 0,
        webhookStatus: message.data.metrics.webhookStatus ?? null,
        webhookError: message.data.metrics.webhookError ?? null,
      });
    }

    // -----------------------------------------------------------------------
    // run_error — IMAP / email workers
    // -----------------------------------------------------------------------
    if (message.data.status === "run_error") {
      await insertAndEmitRunLog(feedConfig, {
        startedAt: message.data.metrics.startedAt,
        durationMs: message.data.metrics.durationMs,
        status: "error",
        errorMessage: message.data.metrics.errorMessage ?? "Unknown error",
        httpStatus: null,
        timedOut: false,
        itemCount: null,
        selectorMatches: null,
        dateFallbacks: 0,
        duplicateGuids: 0,
        webhookStatus: null,
        webhookError: null,
      });
    }
  };

  worker.onerror = async (error) => {
    console.error("Worker error:", error);
    await insertAndEmitRunLog(feedConfig, {
      startedAt: Date.now(),
      durationMs: null,
      status: "error",
      errorMessage: error.message ?? "Worker crashed unexpectedly",
      httpStatus: null,
      timedOut: false,
      itemCount: null,
      selectorMatches: null,
      dateFallbacks: 0,
      duplicateGuids: 0,
      webhookStatus: null,
      webhookError: null,
    });
  };
}

// ---------------------------------------------------------------------------
// setFeedUpdaterInterval
// ---------------------------------------------------------------------------

export function setFeedUpdaterInterval(feedConfig: any): void {
  const feedId = feedConfig.feedId;

  if (!feedUpdaters.has(feedId)) {
    console.log("Initializing worker for feed:", feedId);
    initializeWorker(feedConfig);
    feedUpdaters.get(feedId)!.postMessage({
      command: "start",
      config: feedConfig,
      encryptionKey: _encryptionKey,
    });

    // Set interval inside this block so worker and interval are always paired —
    // avoids a race where terminateWorker is called between worker creation and
    // interval registration.
    if (feedConfig.feedType !== "email" && !feedIntervals.has(feedId)) {
      console.log("Setting interval for feed:", feedId);
      const interval = setInterval(() => {
        console.log("Engaging worker for feed:", feedId);
        const worker = feedUpdaters.get(feedId);
        if (worker) {
          worker.postMessage({ command: "start", config: feedConfig });
        }
      }, feedConfig.refreshTime * 60 * 1000);
      feedIntervals.set(feedId, interval);
    }
  }
}

// ---------------------------------------------------------------------------
// terminateWorker
// ---------------------------------------------------------------------------

export function terminateWorker(feedId: string): void {
  const worker = feedUpdaters.get(feedId);
  if (worker) {
    worker.terminate();
    feedUpdaters.delete(feedId);
  }
}

// ---------------------------------------------------------------------------
// clearFeedUpdaterInterval
// ---------------------------------------------------------------------------

export function clearFeedUpdaterInterval(feedId: string): void {
  const interval = feedIntervals.get(feedId);
  if (interval) {
    clearInterval(interval);
    feedIntervals.delete(feedId);
  }
}

// ---------------------------------------------------------------------------
// clearAllFeedUpdaterIntervals
// ---------------------------------------------------------------------------

export function clearAllFeedUpdaterIntervals(): void {
  // Iterating with .entries() snapshot is safe — deletions of returned keys don't cause skips
  for (const [feedId] of feedIntervals.entries()) {
    clearFeedUpdaterInterval(feedId);
    terminateWorker(feedId);
  }
}

// ---------------------------------------------------------------------------
// processFeedsAtStart
// ---------------------------------------------------------------------------

export async function processFeedsAtStart(configsDir: string): Promise<void> {
  try {
    const files = await readdir(configsDir);
    const yamlFiles = files.filter((f) => f.endsWith(".yaml"));

    for (const f of yamlFiles) {
      const filePath = join(configsDir, f);
      const yamlContent = await readFile(filePath, "utf8");
      const feedConfig = yaml.load(yamlContent) as any;
      console.log("Processing feed:", feedConfig.feedId);
      setFeedUpdaterInterval(feedConfig);
    }
  } catch (error) {
    console.error("Error processing feeds:", error);
  }
}

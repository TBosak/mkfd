import { file } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { Hono, type Context } from "hono";
import { serveStatic, getConnInfo } from "hono/bun";
import { except } from "hono/combine";
import minimist from "minimist";
import { join } from "node:path";
import { CookieStore, sessionMiddleware } from "hono-sessions";
import { createInterface } from "readline";
import { EventEmitter } from "node:events";
import {
  initDb,
  getDb,
  createFeedHistoryStore,
  migrateLegacyFeedHistory,
} from "./lib/analytics/db";
import { setFeedHistoryStore } from "./utilities/feed-history.utility";
import {
  initWorkerManager,
  clearAllFeedUpdaterIntervals,
  processFeedsAtStart,
} from "./utilities/worker-manager.utility";
import { feedsRouter } from "./routes/feeds";
import { previewRouter } from "./routes/preview";
import { healthRouter } from "./routes/health";
import { utilsRouter } from "./routes/utils";
import { settingsRouter } from "./routes/settings";
import { sourceAssistantRouter } from "./routes/source-assistant";
import { profilesRouter } from "./routes/profiles";
import { catalogRouter } from "./routes/catalog";
import { webhookFeedRouter } from "./routes/webhook";
import { filesystemRouter } from "./routes/filesystem";
import { serviceConnectorsRouter } from "./routes/service-connectors";

// ---------------------------------------------------------------------------
// Startup helpers
// ---------------------------------------------------------------------------

const args = minimist(process.argv.slice(2));
const SSL = process.env.SSL === "true" || args.ssl === true;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getSecrets() {
  const passkey = process.env.PASSKEY ?? args.passkey;
  const cookieSecret = process.env.COOKIE_SECRET ?? args.cookieSecret;
  const encryptionKey = process.env.ENCRYPTION_KEY ?? args.encryptionKey;

  if (passkey && cookieSecret && encryptionKey) {
    return { passkey, cookieSecret, encryptionKey };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Missing required secrets (PASSKEY, COOKIE_SECRET, ENCRYPTION_KEY) " +
      "and stdin is not a TTY. Cannot prompt for secrets.",
    );
  }

  return {
    passkey: passkey ?? (await prompt("Enter passkey: ")),
    cookieSecret: cookieSecret ?? (await prompt("Enter cookie secret: ")),
    encryptionKey: encryptionKey ?? (await prompt("Enter encryption key: ")),
  };
}

// ---------------------------------------------------------------------------
// Secrets + directory setup
// ---------------------------------------------------------------------------

const { passkey, cookieSecret, encryptionKey } = await getSecrets();

const feedPath = join(__dirname, "/public/feeds");
if (!existsSync(feedPath)) mkdirSync(feedPath);

const configsDir = join(__dirname, "configs");
if (!existsSync(configsDir)) mkdirSync(configsDir);

// ---------------------------------------------------------------------------
// Database init
// ---------------------------------------------------------------------------

try {
  initDb();
} catch (e) {
  console.error(
    "[Analytics] Failed to initialize DB — health tracking disabled:",
    e,
  );
}

try {
  const runtimeDb = getDb();
  setFeedHistoryStore(createFeedHistoryStore(runtimeDb));
  const migrationResult = await migrateLegacyFeedHistory(runtimeDb);
  console.log(
    `[Startup] Feed history migration complete: ` +
      `${migrationResult.snapshots} snapshots, ` +
      `${migrationResult.dateIndexes} date indexes migrated.`,
  );
} catch (err) {
  console.error(
    "[Startup] Feed history DB init failed — continuing with file-based fallback:",
    err,
  );
}

// ---------------------------------------------------------------------------
// Worker manager
// ---------------------------------------------------------------------------

const runLogEmitter = new EventEmitter();
runLogEmitter.setMaxListeners(100);

initWorkerManager({ encryptionKey, runLogEmitter });
processFeedsAtStart(configsDir);

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------

const app = new Hono();
const store = new CookieStore();

app.use(
  "*",
  sessionMiddleware({
    store,
    encryptionKey: cookieSecret,
    expireAfterSeconds: 60 * 60 * 24,
    cookieOptions: {
      path: "/",
      httpOnly: true,
      secure: SSL,
      sameSite: "lax",
    },
  }),
);

// Auth middleware — allows local connections and authenticated sessions through
const authMiddleware = async (c: Context, next: () => Promise<void>) => {
  const connInfo = await getConnInfo(c);
  const isLocal =
    !connInfo?.remote?.address ||
    ["127.0.0.1", "::1"].includes(connInfo.remote.address);

  if (isLocal) return await next();

  const session = c.get("session");
  const authenticated = session.get("authenticated");
  if (authenticated === true) return await next();

  if (c.req.method === "POST" && c.req.path === "/passkey") {
    const body = await c.req.parseBody();
    const inputKey = body.passkey;
    if (inputKey === passkey) {
      session.set("authenticated", true);
      return c.redirect("/");
    } else {
      return c.html(
        '<p>Incorrect passkey. <a href="/passkey">Try again</a>.</p>',
      );
    }
  }

  if (c.req.path === "/passkey") return await next();

  return c.redirect("/passkey");
};

app.use("/*", except("/public/feeds/*", authMiddleware));
app.use("/public/*", serveStatic({ root: "./" }));
app.use("/configs/*", serveStatic({ root: "./" }));

// ---------------------------------------------------------------------------
// Static SPA root
// ---------------------------------------------------------------------------

app.get("/", (ctx) => ctx.html(file("./public/index.html").text()));

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------

app.route("/", feedsRouter({ encryptionKey, configsDir, feedPath }));
app.route("/", previewRouter({ encryptionKey }));
app.route("/", healthRouter({ runLogEmitter }));
app.route("/", utilsRouter({ configsDir, feedPath }));
app.route("/", sourceAssistantRouter);
app.route("/", profilesRouter);
app.route("/", catalogRouter({ encryptionKey, configsDir }));
app.route("/", webhookFeedRouter({ configsDir }));
app.route("/", filesystemRouter());
app.route("/", serviceConnectorsRouter({ encryptionKey }));
app.route("/api/settings", settingsRouter);

// ---------------------------------------------------------------------------
// Export + signal handlers
// ---------------------------------------------------------------------------

export default {
  port: 5000,
  fetch: app.fetch,
  idleTimeout: 120,
};

process.on("exit", () => {
  clearAllFeedUpdaterIntervals();
});

process.on("SIGINT", () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});

process.on("SIGTERM", () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});

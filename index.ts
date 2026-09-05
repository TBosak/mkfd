import { file } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { Hono, type Context } from "hono";
import { serveStatic, getConnInfo } from "hono/bun";
import { except } from "hono/combine";
import minimist from "minimist";
import { join } from "node:path";
import { CookieStore, sessionMiddleware } from "hono-sessions";
import { createInterface } from "node:readline";
import { createHash, timingSafeEqual } from "node:crypto";
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

/**
 * Routes that must stay reachable without a session. `/public/feeds/*` is the
 * published feed output. `/webhook-feeds/*` is inbound ingress from external
 * services, which authenticates independently on a per-feed token in
 * routes/webhook.ts; it previously "worked" only because a local-looking peer
 * skipped auth entirely, so removing that bypass without this exception would
 * have permanently broken webhook ingress.
 */
const ANONYMOUS_ROUTES = ["/public/feeds/*", "/webhook-feeds/*"] as const;

/** True when the request itself arrived over TLS. */
function requestIsSecure(c: Context): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The session cookie's `Secure` attribute must track the actual connection,
 * not the `SSL` startup flag. A plaintext LAN install that issued `Secure`
 * cookies could never store one, making login impossible; a TLS install that
 * omitted it would leak the session over any downgrade.
 *
 * `X-Forwarded-Proto` is deliberately NOT honoured. There is no trusted-proxy
 * configuration surface yet, and trusting it unconditionally would let any
 * client force a `Secure` cookie the browser then refuses to send back,
 * locking the user out of their own instance.
 */
app.use("*", async (c, next) => {
  await next();
  const setCookie = c.res.headers.get("set-cookie");
  if (!setCookie) return;
  const hasSecure = /;\s*Secure/i.test(setCookie);
  const shouldBeSecure = requestIsSecure(c);
  if (hasSecure === shouldBeSecure) return;
  const rewritten = shouldBeSecure
    ? `${setCookie}; Secure`
    : setCookie.replace(/;\s*Secure/gi, "");
  c.res.headers.set("set-cookie", rewritten);
});

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

/**
 * Development-only bypass. Off unless explicitly opted into, and refused
 * outright in a production configuration so it cannot be switched on by
 * accident on a deployed instance. The peer address is never consulted:
 * behind a reverse proxy the peer is 127.0.0.1 and in Docker it is the bridge
 * gateway, so treating loopback as authorization disabled auth entirely for
 * every remote visitor on the shipped compose topology.
 */
const devBypassEnabled =
  process.env.TRUST_LOCAL === "true" && process.env.NODE_ENV !== "production";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects cross-origin state-changing requests. Compares parsed origins rather
 * than substrings, so `http://localhost.evil.example` cannot masquerade as
 * `http://localhost`. A missing `Origin` is allowed: non-browser clients and
 * ordinary form posts to `/passkey` omit it, and `SameSite=Lax` already covers
 * the browser case this guard is defending.
 */
function isCrossOriginStateChange(c: Context): boolean {
  if (SAFE_METHODS.has(c.req.method)) return false;
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(c.req.url).host;
  } catch {
    return true;
  }
}

/**
 * Login throttling, keyed on the real peer address from the connection rather
 * than any client-supplied header, so rotating `X-Forwarded-For` cannot reset
 * the counter. Once locked out, even a correct passkey is refused for the
 * remainder of the window.
 */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, { count: number; firstAt: number }>();

function loginThrottleKey(c: Context): string {
  try {
    return getConnInfo(c).remote?.address ?? "unknown-peer";
  } catch {
    return "unknown-peer";
  }
}

function isLoginLockedOut(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_LOCKOUT_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string): void {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.firstAt > LOGIN_LOCKOUT_MS) {
    loginFailures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

/**
 * Constant-time passkey comparison. Both sides are hashed to a fixed-length
 * digest first so `timingSafeEqual` never sees unequal lengths (which would
 * throw and leak length through the error path), and so comparison time does
 * not vary with the number of matching leading bytes.
 */
function passkeyMatches(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(passkey, "utf8").digest();
  return timingSafeEqual(a, b);
}

// Auth middleware. Authorization derives from the session alone; the peer
// address is never a credential.
const authMiddleware = async (c: Context, next: () => Promise<void>) => {
  if (isCrossOriginStateChange(c)) {
    return c.text("Cross-origin request refused", 403);
  }

  if (devBypassEnabled) return await next();

  const session = c.get("session");
  const authenticated = session?.get("authenticated");
  if (authenticated === true) return await next();

  if (c.req.method === "POST" && c.req.path === "/passkey") {
    const throttleKey = loginThrottleKey(c);
    if (isLoginLockedOut(throttleKey)) {
      return c.text("Too many failed attempts. Try again later.", 429);
    }
    const body = await c.req.parseBody();
    if (passkeyMatches(body.passkey)) {
      loginFailures.delete(throttleKey);
      session.set("authenticated", true);
      return c.redirect("/");
    }
    recordLoginFailure(throttleKey);
    return c.html('<p>Incorrect passkey. <a href="/passkey">Try again</a>.</p>');
  }

  if (c.req.path === "/passkey") return await next();

  return c.redirect("/passkey");
};

app.use("/*", except([...ANONYMOUS_ROUTES], authMiddleware));
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

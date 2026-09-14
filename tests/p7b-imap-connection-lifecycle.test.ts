// TDD slice: p7b-imap-connection-lifecycle (follow-on to p7b-imap-reconnect-policy,
// issue #77: "Timed out while connecting to server" after a reconnect storm).
//
// node/imap-watch.utility.ts imports node-imap at module top level and is
// spawned as a Node subprocess specifically because node-imap does not run
// reliably under Bun. No test in this file may import that module -- doing
// so would pull node-imap into the Bun test runtime, which is the exact
// incompatibility the subprocess exists to avoid. `ImapWatcher` stays inside
// `if (import.meta.main)` and is not exported; this slice does not change
// that.
//
// Behavioral coverage (A1-A6, I1-I4, E1-E4) targets node/imap-connection-lifecycle.ts,
// a module with no node-imap import, driven here through a hand-rolled
// ImapLike fake that never touches a real socket or a real IMAP server.
//
// Wiring coverage (W1-W5) targets node/imap-watch.utility.ts *as text*, the
// same technique tests/browser-adapter-static-guard.test.ts uses for a file
// that cannot be imported under the running test runtime.
//
// RED command: bun test tests/p7b-imap-connection-lifecycle.test.ts
// Expected RED (pre-implementation): the suite fails to resolve
// "../node/imap-connection-lifecycle", because the module does not exist
// yet; the W1/W2/W3/W4 wiring assertions also fail against the current,
// unfixed node/imap-watch.utility.ts.

import { describe, expect, it, mock } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ReconnectScheduler,
	type ReconnectSchedulerOptions,
} from "../node/imap-reconnect-policy";
import {
	ImapConnectionLifecycle,
	type ImapLike,
} from "../node/imap-connection-lifecycle";

// ---------------------------------------------------------------------------
// Deterministic fake timers, identical in shape to the ones already proven
// out in tests/p7b-imap-reconnect-policy.test.ts. Time never advances on its
// own; a pending reconnect only "fires" when a test calls fireOne().
// ---------------------------------------------------------------------------
function createFakeTimers() {
	let nextId = 1;
	const timers = new Map<number, () => void>();

	const setTimeoutFn = mock((fn: () => void, _ms: number) => {
		const id = nextId++;
		timers.set(id, fn);
		return id;
	});

	const clearTimeoutFn = mock((handle: unknown) => {
		timers.delete(handle as number);
	});

	return {
		setTimeoutFn,
		clearTimeoutFn,
		get pendingCount() {
			return timers.size;
		},
		fireOne() {
			if (timers.size !== 1) {
				throw new Error(
					`expected exactly one pending timer, found ${timers.size}`,
				);
			}
			const [id, fn] = [...timers.entries()][0];
			timers.delete(id);
			fn();
		},
	};
}

type FakeTimers = ReturnType<typeof createFakeTimers>;

// ---------------------------------------------------------------------------
// A minimal, structural ImapLike fake. Supports both once() (auto-removing)
// and on() (persistent) registrations against the same event, mirroring how
// a real node-imap Imap instance (an EventEmitter) behaves. emit() lets a
// test drive "ready"/"close"/"error" exactly like the real socket would.
// ---------------------------------------------------------------------------
class FakeConnection implements ImapLike {
	readonly id: number;
	ended = false;
	destroyed = false;
	readonly removeAllListenersCalls: Array<string | undefined> = [];
	private readonly handlers = new Map<
		string,
		Array<{ handler: (...args: unknown[]) => void; once: boolean }>
	>();

	constructor(id: number) {
		this.id = id;
	}

	once(event: string, handler: (...args: unknown[]) => void): unknown {
		this.add(event, handler, true);
		return this;
	}

	on(event: string, handler: (...args: unknown[]) => void): unknown {
		this.add(event, handler, false);
		return this;
	}

	removeAllListeners(event?: string): unknown {
		this.removeAllListenersCalls.push(event);
		if (event === undefined) {
			this.handlers.clear();
		} else {
			this.handlers.delete(event);
		}
		return this;
	}

	end(): void {
		this.ended = true;
	}

	destroy(): void {
		this.destroyed = true;
	}

	/** Test-only: drives listeners exactly like a real EventEmitter would. */
	emit(event: string, ...args: unknown[]): void {
		const list = this.handlers.get(event);
		if (!list || list.length === 0) return;
		const snapshot = [...list];
		this.handlers.set(
			event,
			list.filter((entry) => !entry.once),
		);
		for (const { handler } of snapshot) handler(...args);
	}

	/** Test-only: true while any handler remains attached to any event. */
	get hasListeners(): boolean {
		for (const list of this.handlers.values()) {
			if (list.length > 0) return true;
		}
		return false;
	}

	private add(
		event: string,
		handler: (...args: unknown[]) => void,
		once: boolean,
	) {
		const list = this.handlers.get(event) ?? [];
		list.push({ handler, once });
		this.handlers.set(event, list);
	}
}

function makeScheduler(
	overrides: Partial<ReconnectSchedulerOptions> = {},
	timers: FakeTimers = createFakeTimers(),
) {
	const onGiveUp = mock((_attempts: number) => {});
	const scheduler = new ReconnectScheduler({
		baseDelayMs: 100,
		maxDelayMs: 100_000,
		maxAttempts: 10,
		setTimeoutFn: timers.setTimeoutFn,
		clearTimeoutFn: timers.clearTimeoutFn,
		random: () => 0,
		onGiveUp,
		...overrides,
	});
	return { scheduler, timers, onGiveUp };
}

function makeLifecycle(
	opts: {
		schedulerOptions?: Partial<ReconnectSchedulerOptions>;
		createConnection?: () => ImapLike;
		onReady?: (connection: ImapLike) => void | Promise<void>;
		onTerminalFailure?: (attempts: number) => void;
	} = {},
) {
	const { scheduler, timers, onGiveUp } = makeScheduler(opts.schedulerOptions);

	const connections: FakeConnection[] = [];
	const defaultCreateConnection = mock((): ImapLike => {
		const conn = new FakeConnection(connections.length);
		connections.push(conn);
		return conn;
	});
	const createConnection = opts.createConnection
		? mock(opts.createConnection)
		: defaultCreateConnection;

	const onReady = mock(opts.onReady ?? ((_connection: ImapLike) => {}));
	const onTerminalFailure = mock(opts.onTerminalFailure ?? ((_n: number) => {}));

	const lifecycle = new ImapConnectionLifecycle({
		createConnection,
		onReady,
		scheduler,
		onTerminalFailure,
	});

	return {
		lifecycle,
		connections,
		createConnection,
		onReady,
		onTerminalFailure,
		scheduler,
		timers,
		onGiveUp,
	};
}

// ---------------------------------------------------------------------------
// A1: start() creates exactly one connection and invokes onReady once ready.
// ---------------------------------------------------------------------------
describe("A1: start() creates exactly one connection and invokes onReady once ready", () => {
	it("creates exactly one connection via createConnection", () => {
		const { lifecycle, connections, createConnection } = makeLifecycle();
		expect(lifecycle.connectionsOpened).toBe(0);

		lifecycle.start();

		expect(createConnection).toHaveBeenCalledTimes(1);
		expect(connections.length).toBe(1);
		expect(lifecycle.connectionsOpened).toBe(1);
	});

	it("does not invoke onReady before the connection reports ready", () => {
		const { lifecycle, onReady } = makeLifecycle();
		lifecycle.start();
		expect(onReady).not.toHaveBeenCalled();
	});

	it("invokes onReady exactly once, with the connection, once it reports ready", () => {
		const { lifecycle, connections, onReady } = makeLifecycle();
		lifecycle.start();

		connections[0].emit("ready");

		expect(onReady).toHaveBeenCalledTimes(1);
		expect(onReady).toHaveBeenCalledWith(connections[0]);
	});
});

// ---------------------------------------------------------------------------
// A2: the #77 fan-out. node-imap emits both close and error for one dropped
// connection; that must collapse to exactly one reconnect.
// ---------------------------------------------------------------------------
describe("A2: #77 - a single dropped connection emitting both close and error produces exactly one reconnect", () => {
	it("close then error collapses to one pending timer and one new connection", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");

		connections[0].emit("close");
		connections[0].emit("error", new Error("dropped"));

		expect(timers.pendingCount).toBe(1);

		timers.fireOne();
		expect(connections.length).toBe(2);
	});

	it("error then close (opposite order) also collapses to one reconnect", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");

		connections[0].emit("error", new Error("dropped"));
		connections[0].emit("close");

		expect(timers.pendingCount).toBe(1);

		timers.fireOne();
		expect(connections.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// A3: a connection that never becomes ready also produces exactly one
// reconnect, not zero (silently hung) and not more than one.
// ---------------------------------------------------------------------------
describe("A3: a connection that fails before ready also produces exactly one reconnect", () => {
	it("a bare error with no prior ready schedules exactly one reconnect", () => {
		const { lifecycle, connections, timers, onReady } = makeLifecycle();
		lifecycle.start();
		expect(connections.length).toBe(1);

		connections[0].emit("error", new Error("Timed out while connecting to server"));

		expect(timers.pendingCount).toBe(1);
		expect(onReady).not.toHaveBeenCalled();

		timers.fireOne();
		expect(connections.length).toBe(2);
	});

	it("close+error fired before ready also collapses to one reconnect", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();

		connections[0].emit("close");
		connections[0].emit("error", new Error("timed out"));

		expect(timers.pendingCount).toBe(1);

		timers.fireOne();
		expect(connections.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// A4: teardown happens before the next connection opens. Sockets must not
// accumulate.
// ---------------------------------------------------------------------------
describe("A4: the previous connection is torn down before a new one opens", () => {
	it("the dropped connection has its listeners removed and is ended/destroyed by the time the reconnect fires", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");

		timers.fireOne();

		expect(connections.length).toBe(2);
		expect(connections[0].ended || connections[0].destroyed).toBe(true);
		expect(connections[0].removeAllListenersCalls.length).toBeGreaterThan(0);
		expect(connections[0].hasListeners).toBe(false);
	});

	it("the new connection is a distinct object, untouched by the old one's teardown", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		timers.fireOne();

		expect(connections[1]).not.toBe(connections[0]);
		expect(connections[1].removeAllListenersCalls.length).toBe(0);
		expect(connections[1].ended).toBe(false);
		expect(connections[1].destroyed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// A5: a successful reconnect fires onReady again and resets the scheduler's
// attempt budget.
// ---------------------------------------------------------------------------
describe("A5: a successful reconnect invokes onReady again and resets the scheduler's attempt count", () => {
	it("onReady fires for the new connection and scheduler.attempts returns to 0", () => {
		const { lifecycle, connections, timers, onReady, scheduler } =
			makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		expect(scheduler.attempts).toBe(1);

		timers.fireOne();
		connections[1].emit("ready");

		expect(onReady).toHaveBeenCalledTimes(2);
		expect(onReady).toHaveBeenCalledWith(connections[1]);
		expect(scheduler.attempts).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// A6 / E1: reconnects are driven through the injected ReconnectScheduler, so
// delay growth and the attempt bound come from the locked policy.
// ---------------------------------------------------------------------------
describe("A6 / E1: reconnects are driven through the injected ReconnectScheduler", () => {
	it("delay grows across consecutive failed cycles per the scheduler's own backoff policy", () => {
		const { lifecycle, connections, timers } = makeLifecycle({
			schedulerOptions: { baseDelayMs: 100, maxDelayMs: 1_000_000, maxAttempts: 20 },
		});
		lifecycle.start();

		const delays: number[] = [];
		for (let i = 0; i < 4; i++) {
			connections[i].emit("error", new Error(`drop ${i}`));
			const calls = timers.setTimeoutFn.mock.calls;
			delays.push(calls[calls.length - 1][1] as number);
			timers.fireOne();
		}

		expect(delays[0]).toBe(100);
		for (let i = 0; i < delays.length - 1; i++) {
			expect(delays[i]).toBeLessThan(delays[i + 1]);
		}
	});

	it("once the scheduler reports exhaustion, the lifecycle stops retrying and reports it once via onTerminalFailure", () => {
		const { lifecycle, connections, timers, onTerminalFailure } = makeLifecycle({
			schedulerOptions: { baseDelayMs: 10, maxDelayMs: 1_000, maxAttempts: 2 },
		});
		lifecycle.start();

		connections[0].emit("error", new Error("drop 1"));
		expect(timers.pendingCount).toBe(1);
		timers.fireOne();

		connections[1].emit("error", new Error("drop 2"));
		expect(timers.pendingCount).toBe(1);
		timers.fireOne();

		connections[2].emit("error", new Error("drop 3"));

		expect(timers.pendingCount).toBe(0);
		expect(connections.length).toBe(3);
		expect(onTerminalFailure).toHaveBeenCalledTimes(1);
		expect(onTerminalFailure).toHaveBeenCalledWith(2);
	});
});

// ---------------------------------------------------------------------------
// I1: at most one connection live at a time.
// ---------------------------------------------------------------------------
describe("I1: at most one connection is live at a time; connectionsOpened tracks successful opens", () => {
	it("connectionsOpened increases by exactly one per successful reconnect cycle", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		expect(lifecycle.connectionsOpened).toBe(1);

		connections[0].emit("ready");
		connections[0].emit("close");
		timers.fireOne();
		expect(lifecycle.connectionsOpened).toBe(2);

		connections[1].emit("ready");
		connections[1].emit("error", new Error("dropped again"));
		timers.fireOne();
		expect(lifecycle.connectionsOpened).toBe(3);
	});

	it("every connection except the most recent has been torn down", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		timers.fireOne();
		connections[1].emit("ready");
		connections[1].emit("close");
		timers.fireOne();

		expect(connections.length).toBe(3);
		for (const conn of connections.slice(0, -1)) {
			expect(conn.ended || conn.destroyed).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// I2: stop() is terminal. It cancels a pending reconnect and tears down the
// live connection; nothing resurrects the watcher afterward.
// ---------------------------------------------------------------------------
describe("I2: stop() cancels pending reconnects and tears down the current connection", () => {
	it("cancels a pending reconnect timer", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		expect(timers.pendingCount).toBe(1);

		lifecycle.stop();
		expect(timers.pendingCount).toBe(0);
	});

	it("ends/destroys the current connection even with no pending reconnect", () => {
		const { lifecycle, connections } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");

		lifecycle.stop();
		expect(connections[0].ended || connections[0].destroyed).toBe(true);
	});

	it("no amount of late close/error events after stop() opens another connection or reschedules", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		lifecycle.stop();

		connections[0].emit("close");
		connections[0].emit("error", new Error("late"));
		connections[0].emit("close");
		connections[0].emit("error", new Error("late again"));

		expect(connections.length).toBe(1);
		expect(timers.pendingCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// I3: listener registrations do not accumulate across cycles.
// ---------------------------------------------------------------------------
describe("I3: listener registrations do not accumulate across repeated failure/recovery cycles", () => {
	it("a discarded connection carries no listeners after each cycle", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();

		for (let i = 0; i < 3; i++) {
			connections[i].emit("ready");
			connections[i].emit("close");
			connections[i].emit("error", new Error(`drop ${i}`));
			timers.fireOne();
			expect(connections[i].hasListeners).toBe(false);
		}

		expect(connections.length).toBe(4);
	});

	it("late events on an already-discarded connection do not trigger a new reconnect", () => {
		const { lifecycle, connections, timers } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");
		connections[0].emit("close");
		timers.fireOne();
		connections[1].emit("ready");

		connections[0].emit("close");
		connections[0].emit("error", new Error("stray"));

		expect(connections.length).toBe(2);
		expect(timers.pendingCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// I4: onReady is never invoked for a connection that has already been torn
// down.
// ---------------------------------------------------------------------------
describe("I4: onReady is never invoked for a connection that has already been torn down", () => {
	it("a stale 'ready' firing on an abandoned pre-ready connection does not invoke onReady for it", () => {
		const { lifecycle, connections, timers, onReady } = makeLifecycle();
		lifecycle.start();
		expect(connections.length).toBe(1);

		connections[0].emit("error", new Error("timed out while connecting"));
		timers.fireOne();

		expect(connections.length).toBe(2);
		connections[1].emit("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
		expect(onReady).toHaveBeenCalledWith(connections[1]);

		connections[0].emit("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// E2: a createConnection that throws is a failed attempt, not an unhandled
// rejection, and still goes through the single-flight reconnect path.
// ---------------------------------------------------------------------------
describe("E2: a createConnection that throws is treated as a failed attempt via the single-flight reconnect path", () => {
	it("does not throw out of the timer callback and retries exactly once", () => {
		const timers = createFakeTimers();
		const onGiveUp = mock((_attempts: number) => {});
		const scheduler = new ReconnectScheduler({
			baseDelayMs: 50,
			maxDelayMs: 10_000,
			maxAttempts: 10,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			random: () => 0,
			onGiveUp,
		});

		const connections: FakeConnection[] = [];
		let callCount = 0;
		const createConnection = mock((): ImapLike => {
			callCount++;
			if (callCount === 2) {
				throw new Error("connection factory exploded");
			}
			const conn = new FakeConnection(connections.length);
			connections.push(conn);
			return conn;
		});

		const onReady = mock((_connection: ImapLike) => {});
		const onTerminalFailure = mock((_attempts: number) => {});

		const lifecycle = new ImapConnectionLifecycle({
			createConnection,
			onReady,
			scheduler,
			onTerminalFailure,
		});

		lifecycle.start();
		expect(connections.length).toBe(1);
		connections[0].emit("ready");
		expect(onReady).toHaveBeenCalledTimes(1);

		connections[0].emit("close");
		expect(timers.pendingCount).toBe(1);

		expect(() => timers.fireOne()).not.toThrow();

		// The throwing attempt did not produce a second live connection...
		expect(connections.length).toBe(1);
		// ...but did go through the single-flight path again: exactly one new
		// reconnect is now pending -- not zero (silently gave up after one
		// factory error) and not more than one (an unhandled-rejection style
		// double schedule).
		expect(timers.pendingCount).toBe(1);
		expect(onTerminalFailure).not.toHaveBeenCalled();

		expect(() => timers.fireOne()).not.toThrow();
		expect(connections.length).toBe(2);
		expect(callCount).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// E3: an onReady callback that throws must not corrupt lifecycle state.
// ---------------------------------------------------------------------------
describe("E3: an onReady callback that throws must not corrupt lifecycle state", () => {
	it("does not prevent teardown; a later failure still reconnects exactly once", () => {
		const { lifecycle, connections, onReady, timers } = makeLifecycle({
			onReady: () => {
				throw new Error("onReady exploded");
			},
		});

		lifecycle.start();
		expect(connections.length).toBe(1);

		expect(() => connections[0].emit("ready")).not.toThrow();
		expect(onReady).toHaveBeenCalledTimes(1);

		connections[0].emit("close");
		connections[0].emit("error", new Error("dropped"));
		expect(timers.pendingCount).toBe(1);

		timers.fireOne();
		expect(connections.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// E4: stop() before start(), and stop() called twice, are both safe.
// ---------------------------------------------------------------------------
describe("E4: stop() is safe before start() and when called twice", () => {
	it("stop() before start() does not throw", () => {
		const { lifecycle } = makeLifecycle();
		expect(() => lifecycle.stop()).not.toThrow();
	});

	it("stop() called twice does not throw and does not double-tear-down", () => {
		const { lifecycle, connections } = makeLifecycle();
		lifecycle.start();
		connections[0].emit("ready");

		expect(() => lifecycle.stop()).not.toThrow();
		expect(() => lifecycle.stop()).not.toThrow();
		expect(connections[0].ended || connections[0].destroyed).toBe(true);
		expect(connections.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// W1-W5: node/imap-watch.utility.ts cannot be imported under Bun (it pulls
// in node-imap at module top level). These assertions read it as plain
// source text instead, the same technique
// tests/browser-adapter-static-guard.test.ts uses for its unimportable
// target.
// ---------------------------------------------------------------------------
const REPO_ROOT = join(import.meta.dir, "..");
const WATCHER_PATH = join(REPO_ROOT, "node", "imap-watch.utility.ts");

// W5: fails loudly rather than passing vacuously if the file is missing or
// unreadable.
function readWatcherSource(path: string = WATCHER_PATH): string {
	if (!existsSync(path)) {
		throw new Error(`expected watcher source file to exist at ${path}`);
	}
	const text = readFileSync(path, "utf8");
	if (text.length === 0) {
		throw new Error(`watcher source file at ${path} is empty`);
	}
	return text;
}

describe("W5: the structural guard reads source text (it never imports node/imap-watch.utility.ts) and cannot pass vacuously", () => {
	it("the real watcher source file exists and is non-empty", () => {
		expect(existsSync(WATCHER_PATH)).toBe(true);
		expect(readWatcherSource().length).toBeGreaterThan(0);
	});

	it("reading a missing file throws instead of silently returning an empty/passing result", () => {
		const bogusPath = join(REPO_ROOT, "node", "does-not-exist-imap-watch.utility.ts");
		expect(existsSync(bogusPath)).toBe(false);
		expect(() => readWatcherSource(bogusPath)).toThrow();
	});
});

describe("W1: the fan-out pair (close+error both wired directly to reconnect) is gone", () => {
	it("does not contain both an on('close', ...) and an on('error', ...) that each call reconnect", () => {
		const text = readWatcherSource();
		const closeCallsReconnect = /\.on\(\s*["']close["']\s*,[\s\S]{0,80}?reconnect/.test(
			text,
		);
		const errorCallsReconnect = /\.on\(\s*["']error["']\s*,[\s\S]{0,80}?reconnect/.test(
			text,
		);
		expect(
			closeCallsReconnect && errorCallsReconnect,
			"found both a close-handler and an error-handler directly invoking reconnect " +
				"-- the #77 fan-out this slice removes",
		).toBe(false);
	});
});

describe("W2: the bare, uncancellable setTimeout(...this.start()...) reconnect is gone", () => {
	it("does not contain a discarded setTimeout handle driving this.start()", () => {
		const text = readWatcherSource();
		const bareReconnectTimeout = /setTimeout\(\s*\(\)\s*=>\s*this\.start\(\)/.test(
			text,
		);
		expect(
			bareReconnectTimeout,
			"found a bare setTimeout(() => this.start(), ...) with no stored handle",
		).toBe(false);
	});
});

describe("W3: the watcher imports and uses ImapConnectionLifecycle", () => {
	it("imports ImapConnectionLifecycle from the new lifecycle module", () => {
		const text = readWatcherSource();
		expect(text.includes("ImapConnectionLifecycle")).toBe(true);
		expect(/from\s+["'][^"']*imap-connection-lifecycle(?:\.ts)?["']/.test(text)).toBe(
			true,
		);
	});

	it("actually constructs an ImapConnectionLifecycle, not merely importing the name", () => {
		const text = readWatcherSource();
		expect(/new\s+ImapConnectionLifecycle\s*\(/.test(text)).toBe(true);
	});
});

describe("W4: setMaxListeners(20) is gone", () => {
	it("no longer masks the listener leak with an inflated listener cap", () => {
		const text = readWatcherSource();
		expect(/setMaxListeners\(/.test(text)).toBe(false);
	});
});

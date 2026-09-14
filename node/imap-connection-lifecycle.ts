/**
 * Connection lifecycle for the IMAP watcher.
 *
 * Deliberately free of any `node-imap` import. The watcher runs as a Node
 * subprocess (`node --experimental-strip-types ./node/imap-watch.utility.ts`)
 * because Bun does not work reliably with the IMAP modules, and
 * `imap-watch.utility.ts` imports `node-imap` at module top level. Anything
 * that imports it is therefore unreachable from the Bun test suite. Keeping
 * this module structurally typed is what makes the behaviour testable at all —
 * the same approach `imap-reconnect-policy.ts` takes.
 *
 * Do not add a `node-imap` import here. The connection arrives through
 * `createConnection` and is described only by the members actually used.
 *
 * This is the half of the issue #77 fix that owns *how* a connection is
 * replaced: tearing the old one down before opening a new one, so sockets and
 * listeners cannot accumulate toward the provider's connection limit.
 * `ReconnectScheduler` owns *when*.
 */

import type { ReconnectScheduler } from "./imap-reconnect-policy.ts";

/** Only the members this module uses. A real node-imap connection satisfies it. */
export interface ImapLike {
	once(event: string, handler: (...args: unknown[]) => void): unknown;
	on(event: string, handler: (...args: unknown[]) => void): unknown;
	removeAllListeners(event?: string): unknown;
	end(): void;
	destroy?: () => void;
}

export interface ImapConnectionLifecycleOptions {
	/** Builds a fresh connection. Called once per open, never reused. */
	createConnection: () => ImapLike;
	/** Invoked when a connection reports ready. Receives the live connection. */
	onReady: (connection: ImapLike) => void | Promise<void>;
	/** Owns retry timing, backoff and the attempt budget. */
	scheduler: ReconnectScheduler;
	/** Called once when the attempt budget is exhausted. */
	onTerminalFailure?: (attempts: number) => void;
}

export class ImapConnectionLifecycle {
	private readonly options: ImapConnectionLifecycleOptions;
	private current: ImapLike | undefined;
	private opened = 0;
	private stopped = false;

	constructor(options: ImapConnectionLifecycleOptions) {
		this.options = options;
	}

	/** Connections opened since construction, including reconnects. */
	get connectionsOpened(): number {
		return this.opened;
	}

	start(): void {
		if (this.stopped) return;
		this.open();
	}

	/**
	 * Terminal. Cancels any pending reconnect and tears down the live
	 * connection.
	 *
	 * The old code ended the socket but left the reconnect timer running, so a
	 * stopped watcher reconnected anyway. Order matters here: the scheduler is
	 * stopped first, so a `close` emitted synchronously by teardown cannot
	 * schedule anything.
	 */
	stop(): void {
		this.stopped = true;
		this.options.scheduler.stop();
		this.teardown();
	}

	private open(): void {
		if (this.stopped) return;

		let connection: ImapLike;
		try {
			connection = this.options.createConnection();
		} catch {
			// A factory that throws is just a failed attempt; it goes through the
			// same single-flight path rather than escaping as an unhandled error.
			this.requestReconnect();
			return;
		}

		this.current = connection;
		this.opened += 1;

		connection.once("ready", () => {
			// Ignore a late ready from a connection already replaced or stopped.
			if (this.stopped || this.current !== connection) return;
			this.options.scheduler.onConnected();
			try {
				void this.options.onReady(connection);
			} catch {
				// A failing consumer must not prevent teardown or wedge the
				// lifecycle; the next drop still reconnects normally.
			}
		});

		// node-imap emits both of these for a single dropped connection, which is
		// what produced the storm in #77. Both are wired, and `requestReconnect`
		// collapses them.
		connection.on("close", () => this.handleDrop(connection));
		connection.on("error", () => this.handleDrop(connection));
	}

	private handleDrop(connection: ImapLike): void {
		if (this.stopped) return;
		// A connection already torn down must not schedule anything. Without this
		// a late event from a discarded socket revives the storm.
		if (this.current !== connection) return;
		this.requestReconnect();
	}

	private requestReconnect(): void {
		const outcome = this.options.scheduler.schedule(() => {
			this.teardown();
			this.open();
		});

		if (!outcome.scheduled && outcome.reason === "exhausted") {
			this.options.onTerminalFailure?.(this.options.scheduler.attempts);
		}
	}

	/** Removes every listener and closes the socket, at most once per connection. */
	private teardown(): void {
		const connection = this.current;
		if (connection === undefined) return;
		this.current = undefined;

		connection.removeAllListeners();
		try {
			if (connection.destroy) connection.destroy();
			else connection.end();
		} catch {
			// Already-dead sockets throw on close; the listeners are gone either
			// way, which is the part that matters.
		}
	}
}

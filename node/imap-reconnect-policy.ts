/**
 * Reconnect scheduling policy.
 *
 * Extracted as its own module for two reasons. The behaviour it governs could
 * not be tested where it used to live — `ImapWatcher` is declared inside a
 * function in `imap-watch.utility.ts` and is not exported, so nothing could
 * reach its reconnect logic. And that file has diverged substantially between
 * branches, so a fix written inline would have to be written twice. This module
 * has no IMAP, socket, or network dependency and is therefore portable
 * unchanged.
 *
 * It exists because of a reported failure (issue #77): email scraping worked at
 * container start and then failed permanently with "Timed out while connecting
 * to server", recovering only on restart. The cause was a reconnect storm.
 * `node-imap` emits both `close` and `error` for a single dropped connection,
 * both were wired to reconnect, and the surrounding `catch` called it a third
 * time — so pending timers multiplied every cycle until the mail provider's
 * concurrent-connection limit was reached, after which every new connection
 * timed out.
 *
 * The rule that prevents it is single-flight: one dropped connection produces
 * exactly one reconnect, however many events report it.
 */

export interface ReconnectSchedulerOptions {
	/** Delay before the first retry. Subsequent retries grow from here. */
	baseDelayMs: number;
	/** Hard ceiling on any delay, including jitter. */
	maxDelayMs: number;
	/** Consecutive failures tolerated before giving up. */
	maxAttempts: number;
	/** Injectable for tests; defaults to the global timer. */
	setTimeoutFn?: (fn: () => void, ms: number) => unknown;
	/** Injectable for tests; defaults to the global timer. */
	clearTimeoutFn?: (handle: unknown) => void;
	/** Injectable for tests; defaults to Math.random. */
	random?: () => number;
	/** Called once when the attempt budget is exhausted. */
	onGiveUp?: (attempts: number) => void;
}

export type ScheduleOutcome =
	| { scheduled: true; delayMs: number; attempt: number }
	| {
			scheduled: false;
			reason: "already-pending" | "stopped" | "exhausted";
	  };

/**
 * Bounds how far the exponent may grow before the ceiling would clamp it
 * anyway. Without this, a long enough failure streak overflows the shift into
 * Infinity, and `Math.min(Infinity, max)` is fine but `Infinity * 0` in the
 * jitter term is NaN.
 */
const MAX_EXPONENT = 31;

/** Jitter is added on top of the backoff, never subtracted from it. */
const JITTER_RATIO = 0.25;

export class ReconnectScheduler {
	private readonly options: Required<
		Omit<ReconnectSchedulerOptions, "onGiveUp">
	> & {
		onGiveUp?: (attempts: number) => void;
	};

	private handle: unknown;
	private attemptCount = 0;
	private stopped = false;
	private gaveUp = false;

	constructor(options: ReconnectSchedulerOptions) {
		this.options = {
			baseDelayMs: options.baseDelayMs,
			maxDelayMs: options.maxDelayMs,
			maxAttempts: options.maxAttempts,
			setTimeoutFn:
				options.setTimeoutFn ??
				((fn: () => void, ms: number) => setTimeout(fn, ms)),
			clearTimeoutFn:
				options.clearTimeoutFn ??
				((handle: unknown) => {
					clearTimeout(handle as ReturnType<typeof setTimeout>);
				}),
			random: options.random ?? Math.random,
			onGiveUp: options.onGiveUp,
		};
	}

	/** True while a reconnect is waiting to fire. */
	get pending(): boolean {
		return this.handle !== undefined;
	}

	/** Consecutive failures since the last successful connection. */
	get attempts(): number {
		return this.attemptCount;
	}

	/**
	 * Requests a reconnect.
	 *
	 * Single-flight by construction: while one is pending, further requests are
	 * refused rather than queued. That is the whole point — the caller may
	 * legitimately receive several independent notifications of the same
	 * dropped connection.
	 */
	schedule(run: () => void): ScheduleOutcome {
		if (this.stopped) return { scheduled: false, reason: "stopped" };
		if (this.pending) return { scheduled: false, reason: "already-pending" };

		if (this.attemptCount >= this.options.maxAttempts) {
			// Terminal, and reported exactly once. Looping forever is what turned
			// a transient failure into a permanent one in #77.
			if (!this.gaveUp) {
				this.gaveUp = true;
				this.options.onGiveUp?.(this.attemptCount);
			}
			return { scheduled: false, reason: "exhausted" };
		}

		const attempt = this.attemptCount + 1;
		const delayMs = this.delayFor(attempt);
		this.attemptCount = attempt;

		this.handle = this.options.setTimeoutFn(() => {
			// Cleared before `run` executes, so a throwing callback cannot leave
			// the scheduler permanently wedged as "pending".
			this.handle = undefined;
			run();
		}, delayMs);

		return { scheduled: true, delayMs, attempt };
	}

	/**
	 * Reports a successful connection. Resets the attempt budget so an unrelated
	 * failure hours later starts from the base delay rather than the ceiling.
	 */
	onConnected(): void {
		this.attemptCount = 0;
		this.gaveUp = false;
	}

	/** Cancels any pending reconnect. The scheduler remains usable. */
	cancel(): void {
		if (this.handle === undefined) return;
		this.options.clearTimeoutFn(this.handle);
		this.handle = undefined;
	}

	/**
	 * Permanently stops the scheduler and cancels anything pending.
	 *
	 * A watcher that has been told to stop must not resurrect itself: the old
	 * code ended the socket but left timers running, so a stopped watcher
	 * reconnected anyway.
	 */
	stop(): void {
		this.cancel();
		this.stopped = true;
	}

	/**
	 * Exponential backoff, clamped, with additive jitter.
	 *
	 * Jitter is added rather than centred so that a zero-returning `random`
	 * yields exactly the base delay on the first attempt, which keeps the
	 * sequence reproducible and easy to reason about. It is applied before the
	 * final clamp so that jitter can never push a delay past the ceiling.
	 */
	private delayFor(attempt: number): number {
		const { baseDelayMs, maxDelayMs, random } = this.options;

		const exponent = Math.min(Math.max(attempt - 1, 0), MAX_EXPONENT);
		const growth = baseDelayMs * 2 ** exponent;
		const capped = Math.min(growth, maxDelayMs);
		const jitter = random() * capped * JITTER_RATIO;

		const delay = Math.min(capped + jitter, maxDelayMs);
		return Number.isFinite(delay) && delay > 0 ? delay : 0;
	}
}

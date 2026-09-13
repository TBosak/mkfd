import { describe, expect, it, mock } from "bun:test";
import { ReconnectScheduler } from "../node/imap-reconnect-policy";
import type { ReconnectSchedulerOptions } from "../node/imap-reconnect-policy";

// Deterministic stand-in for setTimeout/clearTimeout. Time never advances on
// its own; tests decide exactly when a pending reconnect "fires" by calling
// fireOne(). This is what lets the suite assert on scheduling decisions
// (A1-A7, I1-I5, E1-E4) without real timers or Bun.sleep.
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
    // Fires the single pending timer. Throws if there isn't exactly one,
    // which is how tests enforce invariant I1 (at most one pending timer).
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

function makeScheduler(
  overrides: Partial<ReconnectSchedulerOptions> = {},
  timers: FakeTimers = createFakeTimers(),
) {
  const onGiveUp = mock((_attempts: number) => {});
  const options: ReconnectSchedulerOptions = {
    baseDelayMs: 100,
    maxDelayMs: 100_000,
    maxAttempts: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    random: () => 0,
    onGiveUp,
    ...overrides,
  };
  const scheduler = new ReconnectScheduler(options);
  return { scheduler, timers, onGiveUp, options };
}

// Runs `count` successful schedule -> fire cycles (no cancellation, no
// exhaustion in between) and returns the delayMs seen at each attempt.
function collectDelaySequence(
  scheduler: ReconnectScheduler,
  timers: FakeTimers,
  count: number,
): number[] {
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    const outcome = scheduler.schedule(() => {});
    if (!outcome.scheduled) {
      throw new Error(`schedule() unexpectedly not scheduled: ${outcome.reason}`);
    }
    delays.push(outcome.delayMs);
    timers.fireOne();
  }
  return delays;
}

describe("ReconnectScheduler: A1 first schedule", () => {
  it("returns scheduled:true with attempt 1 on the first call", () => {
    const { scheduler } = makeScheduler();
    const outcome = scheduler.schedule(() => {});
    expect(outcome).toMatchObject({ scheduled: true, attempt: 1 });
  });

  it("does not invoke run synchronously", () => {
    const { scheduler } = makeScheduler();
    const run = mock(() => {});
    scheduler.schedule(run);
    expect(run).not.toHaveBeenCalled();
  });

  it("invokes run only once the fake timer fires", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});
    scheduler.schedule(run);
    expect(run).not.toHaveBeenCalled();
    timers.fireOne();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("ReconnectScheduler: A2 / #77 fan-out", () => {
  it("a second schedule() while pending returns already-pending and arranges nothing new", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});
    const first = scheduler.schedule(run);
    const second = scheduler.schedule(run);

    expect(first.scheduled).toBe(true);
    expect(second).toEqual({ scheduled: false, reason: "already-pending" });
    expect(timers.pendingCount).toBe(1);
  });

  it("#77: three schedule() calls fired back to back for one dropped connection produce exactly one timer and one run", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});

    const r1 = scheduler.schedule(run);
    const r2 = scheduler.schedule(run);
    const r3 = scheduler.schedule(run);

    expect(r1.scheduled).toBe(true);
    expect(r2).toEqual({ scheduled: false, reason: "already-pending" });
    expect(r3).toEqual({ scheduled: false, reason: "already-pending" });
    expect(timers.pendingCount).toBe(1);

    timers.fireOne();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("ReconnectScheduler: A3 growing delay", () => {
  it("delay grows across consecutive attempts and the first attempt starts at baseDelayMs", () => {
    const { scheduler, timers } = makeScheduler({
      baseDelayMs: 100,
      maxDelayMs: 1_000_000,
      maxAttempts: 20,
      random: () => 0,
    });

    const delays = collectDelaySequence(scheduler, timers, 5);

    expect(delays[0]).toBe(100);
    for (let i = 0; i < delays.length - 1; i++) {
      const current = delays[i];
      const next = delays[i + 1];
      expect(current).toBeLessThan(next);
    }
  });
});

describe("ReconnectScheduler: A4 delay ceiling", () => {
  it("delay never exceeds maxDelayMs across a long failure streak", () => {
    const { scheduler, timers } = makeScheduler({
      baseDelayMs: 100,
      maxDelayMs: 250,
      maxAttempts: 50,
      random: () => 0,
    });

    const delays = collectDelaySequence(scheduler, timers, 40);

    for (const delay of delays) {
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(250);
    }
    // The tail of a long streak must saturate near the ceiling rather than
    // keep climbing unboundedly (jitter may keep it a little under the cap).
    const tail = delays.slice(-5);
    for (const delay of tail) {
      expect(delay).toBeGreaterThanOrEqual(250 * 0.8);
    }
  });
});

describe("ReconnectScheduler: A5 onConnected resets attempts", () => {
  it("a failure after onConnected() starts again at attempt 1 with the base delay", () => {
    const { scheduler, timers } = makeScheduler({
      baseDelayMs: 50,
      maxDelayMs: 10_000,
      maxAttempts: 10,
      random: () => 0,
    });

    const first = scheduler.schedule(() => {});
    if (!first.scheduled) throw new Error("expected scheduled");
    timers.fireOne();

    scheduler.schedule(() => {}); // attempt 2, grows past baseline
    timers.fireOne();

    scheduler.onConnected();
    expect(scheduler.attempts).toBe(0);

    const third = scheduler.schedule(() => {});
    expect(third).toMatchObject({
      scheduled: true,
      attempt: 1,
      delayMs: first.delayMs,
    });
  });
});

describe("ReconnectScheduler: A6 pending clears after run fires", () => {
  it("scheduler is not pending after the timer fires, and can schedule again", () => {
    const { scheduler, timers } = makeScheduler();
    scheduler.schedule(() => {});
    expect(scheduler.pending).toBe(true);

    timers.fireOne();
    expect(scheduler.pending).toBe(false);

    const next = scheduler.schedule(() => {});
    expect(next.scheduled).toBe(true);
  });
});

describe("ReconnectScheduler: A7 jitter and determinism", () => {
  it("different injected random functions produce different delay sequences", () => {
    const { scheduler: schedulerA, timers: timersA } = makeScheduler({
      baseDelayMs: 100,
      maxDelayMs: 1_000_000,
      maxAttempts: 20,
      random: () => 0,
    });
    const { scheduler: schedulerB, timers: timersB } = makeScheduler({
      baseDelayMs: 100,
      maxDelayMs: 1_000_000,
      maxAttempts: 20,
      random: () => 0.9,
    });

    const delaysA = collectDelaySequence(schedulerA, timersA, 5);
    const delaysB = collectDelaySequence(schedulerB, timersB, 5);

    expect(delaysA).not.toEqual(delaysB);
  });

  it("a fixed random produces a fully reproducible delay sequence across independent instances", () => {
    const values = [0.1, 0.4, 0.7, 0.2, 0.9];
    let counter = 0;
    // A stateful but deterministic sequence, shared shape across instances
    // by resetting the counter before each run.
    const seededRandom = () => {
      const v = values[counter % values.length];
      counter++;
      return v;
    };

    const optionsBase = {
      baseDelayMs: 20,
      maxDelayMs: 5_000,
      maxAttempts: 20,
    };

    counter = 0;
    const timersA = createFakeTimers();
    const schedulerA = new ReconnectScheduler({
      ...optionsBase,
      setTimeoutFn: timersA.setTimeoutFn,
      clearTimeoutFn: timersA.clearTimeoutFn,
      random: seededRandom,
    });
    const delaysA = collectDelaySequence(schedulerA, timersA, 5);

    counter = 0;
    const timersB = createFakeTimers();
    const schedulerB = new ReconnectScheduler({
      ...optionsBase,
      setTimeoutFn: timersB.setTimeoutFn,
      clearTimeoutFn: timersB.clearTimeoutFn,
      random: seededRandom,
    });
    const delaysB = collectDelaySequence(schedulerB, timersB, 5);

    expect(delaysA).toEqual(delaysB);
  });
});

describe("ReconnectScheduler: I1 at most one pending reconnect", () => {
  it("never exceeds one pending timer across a mixed schedule/cancel/onConnected/stop sequence", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});

    scheduler.schedule(run);
    expect(timers.pendingCount).toBeLessThanOrEqual(1);
    expect(timers.pendingCount).toBe(1);

    scheduler.schedule(run); // already-pending: must not add a second timer
    expect(timers.pendingCount).toBeLessThanOrEqual(1);

    scheduler.cancel();
    expect(timers.pendingCount).toBeLessThanOrEqual(1);
    expect(timers.pendingCount).toBe(0);

    scheduler.schedule(run);
    expect(timers.pendingCount).toBeLessThanOrEqual(1);

    scheduler.onConnected();
    expect(timers.pendingCount).toBeLessThanOrEqual(1);

    scheduler.schedule(run);
    expect(timers.pendingCount).toBeLessThanOrEqual(1);

    scheduler.stop();
    expect(timers.pendingCount).toBeLessThanOrEqual(1);
    expect(timers.pendingCount).toBe(0);

    scheduler.schedule(run); // stopped: must not schedule anything
    expect(timers.pendingCount).toBeLessThanOrEqual(1);
    expect(timers.pendingCount).toBe(0);

    // The invariant held throughout, and stop() actually cancelled the last
    // pending timer rather than merely capping it at one: nothing ever fires.
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ReconnectScheduler: I2 attempts bookkeeping", () => {
  it("attempts increases only on a successful schedule(), and resets only via onConnected()", () => {
    const { scheduler, timers } = makeScheduler();
    expect(scheduler.attempts).toBe(0);

    scheduler.schedule(() => {});
    expect(scheduler.attempts).toBe(1);

    const blocked = scheduler.schedule(() => {});
    expect(blocked.scheduled).toBe(false);
    expect(scheduler.attempts).toBe(1);

    timers.fireOne();
    scheduler.schedule(() => {});
    expect(scheduler.attempts).toBe(2);

    scheduler.cancel();
    expect(scheduler.attempts).toBe(2);

    scheduler.onConnected();
    expect(scheduler.attempts).toBe(0);
  });
});

describe("ReconnectScheduler: I3 cancel / interleaving schedule -> cancel -> schedule", () => {
  it("cancel() clears the pending reconnect through clearTimeoutFn and leaves the scheduler reusable", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});

    const first = scheduler.schedule(run);
    expect(first.scheduled).toBe(true);
    expect(scheduler.pending).toBe(true);

    scheduler.cancel();
    expect(timers.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
    expect(timers.pendingCount).toBe(0);

    const second = scheduler.schedule(run);
    expect(second).toMatchObject({ scheduled: true, attempt: 2 });

    // The cancelled run must never fire.
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ReconnectScheduler: I4 stop / interleaving schedule -> stop -> schedule", () => {
  it("stop() is terminal: it cancels any pending reconnect and every later schedule() reports stopped", () => {
    const { scheduler, timers } = makeScheduler();
    const run = mock(() => {});

    scheduler.schedule(run);
    expect(scheduler.pending).toBe(true);

    scheduler.stop();
    expect(scheduler.pending).toBe(false);
    expect(timers.pendingCount).toBe(0);

    const attempt1 = scheduler.schedule(run);
    const attempt2 = scheduler.schedule(run);
    expect(attempt1).toEqual({ scheduled: false, reason: "stopped" });
    expect(attempt2).toEqual({ scheduled: false, reason: "stopped" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ReconnectScheduler: I5 idempotency", () => {
  it("cancel() is safe and idempotent when nothing is pending", () => {
    const { scheduler } = makeScheduler();
    expect(() => scheduler.cancel()).not.toThrow();
    expect(() => scheduler.cancel()).not.toThrow();

    const outcome = scheduler.schedule(() => {});
    expect(outcome.scheduled).toBe(true);
  });

  it("stop() is safe and idempotent when nothing is pending", () => {
    const { scheduler } = makeScheduler();
    expect(() => scheduler.stop()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });
});

describe("ReconnectScheduler: E1 maxAttempts exhaustion", () => {
  it("gives up after maxAttempts, calling onGiveUp exactly once with the attempt count", () => {
    const { scheduler, timers, onGiveUp } = makeScheduler({
      baseDelayMs: 10,
      maxDelayMs: 1_000,
      maxAttempts: 3,
      random: () => 0,
    });
    const run = mock(() => {});

    for (let i = 0; i < 3; i++) {
      const outcome = scheduler.schedule(run);
      expect(outcome.scheduled).toBe(true);
      timers.fireOne();
    }
    expect(run).toHaveBeenCalledTimes(3);

    const exhausted = scheduler.schedule(run);
    expect(exhausted).toEqual({ scheduled: false, reason: "exhausted" });
    expect(run).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(3);

    // Further attempts stay exhausted without repeating the give-up callback.
    const stillExhausted = scheduler.schedule(run);
    expect(stillExhausted).toEqual({ scheduled: false, reason: "exhausted" });
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});

describe("ReconnectScheduler: E2 recovery after exhaustion / interleaving schedule -> onConnected -> schedule", () => {
  it("onConnected() after exhaustion restores normal scheduling", () => {
    const { scheduler, timers, onGiveUp } = makeScheduler({
      baseDelayMs: 10,
      maxDelayMs: 1_000,
      maxAttempts: 2,
      random: () => 0,
    });
    const run = mock(() => {});

    scheduler.schedule(run);
    timers.fireOne();
    scheduler.schedule(run);
    timers.fireOne();

    expect(scheduler.schedule(run)).toEqual({
      scheduled: false,
      reason: "exhausted",
    });
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    scheduler.onConnected();
    expect(scheduler.attempts).toBe(0);

    const revived = scheduler.schedule(run);
    expect(revived).toMatchObject({ scheduled: true, attempt: 1 });
  });
});

describe("ReconnectScheduler: E3 boundary configurations", () => {
  it("maxAttempts: 0 gives up immediately without scheduling", () => {
    const { scheduler, timers, onGiveUp } = makeScheduler({
      maxAttempts: 0,
    });
    const run = mock(() => {});

    const outcome = scheduler.schedule(run);
    expect(outcome).toEqual({ scheduled: false, reason: "exhausted" });
    expect(timers.pendingCount).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(0);
  });

  it("baseDelayMs: 0 yields a defined, finite, non-negative delay", () => {
    const { scheduler } = makeScheduler({ baseDelayMs: 0, maxDelayMs: 1000 });
    const outcome = scheduler.schedule(() => {});
    if (!outcome.scheduled) throw new Error("expected scheduled");
    expect(Number.isFinite(outcome.delayMs)).toBe(true);
    expect(outcome.delayMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(outcome.delayMs)).toBe(false);
  });

  it("baseDelayMs > maxDelayMs is clamped rather than producing an unbounded delay", () => {
    const { scheduler, timers } = makeScheduler({
      baseDelayMs: 5000,
      maxDelayMs: 100,
      maxAttempts: 10,
      random: () => 0,
    });

    const delays = collectDelaySequence(scheduler, timers, 5);
    for (const delay of delays) {
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(100);
    }
  });
});

describe("ReconnectScheduler: E4 run() throwing must not corrupt state", () => {
  it("leaves the scheduler non-pending and reusable after a throwing run", () => {
    const { scheduler, timers } = makeScheduler();
    const throwingRun = () => {
      throw new Error("boom");
    };

    const outcome = scheduler.schedule(throwingRun);
    expect(outcome.scheduled).toBe(true);

    try {
      timers.fireOne();
    } catch {
      // Whether the throw propagates out to the caller of the timer callback
      // is not specified; what matters is the scheduler's own state after.
    }

    expect(scheduler.pending).toBe(false);
    const next = scheduler.schedule(() => {});
    expect(next.scheduled).toBe(true);
  });
});

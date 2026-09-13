// TDD slice: p3-fetch-run-orchestration
//
// The production executor currently exposes only `axiosGet`. The additional
// arguments used below are deliberately behavior-level seams, not an internal
// design prescription. The canonical deterministic vocabulary is
// `advancedFetch`, `now`, `wait`, `signal`, `remainingMs`, and
// `outboundPolicy`; implementations may choose their internal structure while
// preserving these observables.

import { afterEach, describe, expect, test } from "bun:test";
import type { WebScrapingFeedConfig } from "../models/feed-config.model";
import type { FetchPolicy } from "../models/fetch-policy.model";
import { parseExistingFeed } from "../utilities/existing-feed-parser.utility";
import {
	executeWithFetchPolicy,
	resolveFetchPolicy,
} from "../utilities/fetch-policy.utility";
import { assertAndResolveOutboundTarget } from "../utilities/outbound-fetch-policy.utility";
import { observeSource } from "../utilities/source-assistant/observer.utility";
import { fetchWebScrapingHtml } from "../utilities/web-scraping-fetcher.utility";

type FakeResponse = {
	status: number;
	data: unknown;
	headers?: Record<string, unknown>;
	request?: { res?: { responseUrl?: string } };
};

type AdvancedRequest = {
	url: string;
	outboundPolicy?: unknown;
	remainingMs?: number;
	axiosConfig?: Record<string, unknown>;
	signal?: AbortSignal;
};

type RuntimeSeams = {
	advancedFetch?: (request: AdvancedRequest) => Promise<FakeResponse>;
	now?: () => number;
	wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
	signal?: AbortSignal;
};

type ExecutorInput = Parameters<typeof executeWithFetchPolicy>[0] &
	RuntimeSeams;
type Failure = Error & {
	code?: unknown;
	details?: unknown;
	attempts?: Array<{
		attempt: number;
		mode?: string;
		status?: number;
		error?: string;
		outcomeCode?: unknown;
		durationMs?: unknown;
	}>;
};

const PUBLIC_URL = "https://example.com/articles?token=private-query";
const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

function response(
	status: number,
	data = "body",
	headers: Record<string, unknown> = {},
): FakeResponse {
	return {
		status,
		data,
		headers,
		request: { res: { responseUrl: "https://example.com/final" } },
	};
}

async function execute<T = unknown>(args: ExecutorInput) {
	return executeWithFetchPolicy<T>(args);
}

async function failureOf(promise: Promise<unknown>): Promise<Failure> {
	try {
		await promise;
	} catch (error) {
		return error as Failure;
	}
	throw new Error("expected a fetch-policy failure");
}

function exposed(error: unknown): string {
	const candidate = error as { details?: unknown; attempts?: unknown };
	return JSON.stringify({
		string: String(error),
		message: error instanceof Error ? error.message : undefined,
		code: (error as { code?: unknown })?.code,
		details: candidate?.details,
		attempts: candidate?.attempts,
	});
}

function expectTyped(error: unknown, code: string, forbidden: string[] = []) {
	expect(error).toBeDefined();
	const text = exposed(error);
	for (const secret of forbidden) expect(text).not.toContain(secret);
	expect((error as { code?: unknown }).code).toBe(code);
	return text;
}

function attemptsOf(error: Failure): Failure["attempts"] {
	if (Array.isArray(error.attempts)) return error.attempts;
	const details = error.details as
		| { attempts?: Failure["attempts"] }
		| undefined;
	return details?.attempts;
}

function expectAttemptMetrics(
	attempt: {
		outcomeCode?: unknown;
		durationMs?: unknown;
	},
	expectedCode: string,
) {
	expect(attempt.outcomeCode).toBe(expectedCode);
	expect(typeof attempt.durationMs).toBe("number");
	expect(Number.isFinite(attempt.durationMs)).toBe(true);
	expect(attempt.durationMs as number).toBeGreaterThanOrEqual(0);
}

function expectResultDuration(result: unknown) {
	const durationMs = (result as { durationMs?: unknown }).durationMs;
	expect(typeof durationMs).toBe("number");
	expect(Number.isFinite(durationMs)).toBe(true);
	expect(durationMs as number).toBeGreaterThanOrEqual(0);
}

function basePolicy(
	overrides: Partial<FetchPolicy> = {},
): Partial<FetchPolicy> {
	return {
		feedRunTimeoutMs: 5_000,
		maxResponseSizeBytes: 64 * 1024,
		maxRedirects: 2,
		retryCount: 1,
		retryBackoffMode: "none",
		retryBackoffMs: 0,
		mode: "standard",
		fallbackToAdvanced: false,
		...overrides,
	};
}

describe("p3 fetch-run orchestration", () => {
	test("A1: retries transport, 408, 429, and every 5xx, but never ordinary 4xx", async () => {
		for (const first of ["transport", 408, 429, 500, 502, 599] as const) {
			let calls = 0;
			const result = await execute<string>({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 1 }),
				axiosGet: async () => {
					calls++;
					if (calls === 1 && first === "transport")
						throw new Error("socket failure secret-transport");
					return response(calls === 1 ? first : 200, "ok");
				},
			});
			expect(result.data).toBe("ok");
			expect(calls).toBe(2);
			expect(result.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
		}

		for (const status of [400, 401, 403, 404]) {
			let calls = 0;
			const result = await execute({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 5, fallbackToAdvanced: true }),
				axiosGet: async () => {
					calls++;
					return response(status, "ordinary body");
				},
				advancedFetch: async () => response(200, "must-not-fallback"),
			});
			expect(result.status).toBe(status);
			expect(calls).toBe(1);
			expect(result.attempts).toHaveLength(1);
		}
	});

	test("A1/E1: zero and maximum retry counts are exact and over-maximum values clamp", async () => {
		let zeroCalls = 0;
		const zero = await execute({
			url: PUBLIC_URL,
			policy: basePolicy({ retryCount: 0 }),
			axiosGet: async () => {
				zeroCalls++;
				return response(200, "zero");
			},
		});
		expect(zeroCalls).toBe(1);
		expect(zero.attempts).toHaveLength(1);

		const resolved = resolveFetchPolicy({ fetchPolicy: { retryCount: 5 } });
		expect(resolved.retryCount).toBe(5);
		expect(
			resolveFetchPolicy({ fetchPolicy: { retryCount: 6 } }).retryCount,
		).toBe(5);

		const maximumError = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 5 }),
				axiosGet: async () => {
					return response(503, "retry body");
				},
			}),
		);
		expect(attemptsOf(maximumError)).toHaveLength(6);
	});

	test("A2: fixed, exponential, and zero backoff expose the bounded wait sequence", async () => {
		for (const [mode, expected] of [
			["fixed", [7, 7]],
			["exponential", [7, 14]],
			["none", []],
		] as const) {
			const waits: number[] = [];
			let calls = 0;
			const result = await execute({
				url: PUBLIC_URL,
				policy: basePolicy({
					retryCount: 2,
					retryBackoffMode: mode,
					retryBackoffMs: 7,
				}),
				wait: async (ms: number) => {
					waits.push(ms);
				},
				axiosGet: async () => {
					calls++;
					return response(calls < 3 ? 503 : 200, "recovered");
				},
			});
			expect(result.data).toBe("recovered");
			expect(waits).toEqual(expected);
		}
	});

	test("A2/I1/E3: a wait or next attempt is skipped when the remaining deadline cannot fit it", async () => {
		let calls = 0;
		const waits: number[] = [];
		let current = 0;
		const error = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({
					feedRunTimeoutMs: 100,
					retryCount: 1,
					retryBackoffMs: 10,
				}),
				now: () => current,
				wait: async (ms: number) => waits.push(ms),
				axiosGet: async () => {
					calls++;
					current = 95;
					return response(503, "deadline-body");
				},
			}),
		);
		expect(calls).toBe(1);
		expect(waits).toEqual([]);
		expectTyped(error, "FETCH_DEADLINE_EXCEEDED");
	});

	test("A3/I2: direct advanced mode uses only the advanced seam and applies retry classification", async () => {
		for (const first of ["transport", 408, 429] as const) {
			let standardCalls = 0;
			let advancedCalls = 0;
			const result = await execute<string>({
				url: PUBLIC_URL,
				policy: basePolicy({ mode: "advanced", retryCount: 1 }),
				axiosGet: async () => {
					standardCalls++;
					return response(200, "wrong-standard");
				},
				advancedFetch: async () => {
					advancedCalls++;
					if (advancedCalls === 1 && first === "transport")
						throw new Error("advanced transport failure");
					return response(advancedCalls === 1 ? first : 200, "advanced-ok");
				},
			});
			expect(result.data).toBe("advanced-ok");
			expect(standardCalls).toBe(0);
			expect(advancedCalls).toBe(2);
			expect(
				result.attempts.map((attempt) => [attempt.mode, attempt.attempt]),
			).toEqual([
				["advanced", 1],
				["advanced", 2],
			]);
			result.attempts.forEach((attempt, index) => {
				expectAttemptMetrics(
					attempt,
					index === 0
						? first === "transport"
							? "FETCH_TRANSPORT_ERROR"
							: "FETCH_RETRYABLE_STATUS"
						: "FETCH_SUCCESS",
				);
			});
		}

		let ordinaryCalls = 0;
		const ordinary = await execute({
			url: PUBLIC_URL,
			policy: basePolicy({ mode: "advanced", retryCount: 5 }),
			axiosGet: async () => response(200, "wrong-standard"),
			advancedFetch: async () => {
				ordinaryCalls++;
				return response(404, "advanced-ordinary");
			},
		});
		expect(ordinary.status).toBe(404);
		expect(ordinaryCalls).toBe(1);
		expect(ordinary.attempts).toHaveLength(1);
		expectAttemptMetrics(ordinary.attempts[0], "FETCH_ORDINARY_4XX");
	});

	test("A4/I2: fallback happens exactly once only after retry-eligible standard exhaustion", async () => {
		let standardCalls = 0;
		let advancedCalls = 0;
		const result = await execute<string>({
			url: PUBLIC_URL,
			policy: basePolicy({ retryCount: 1, fallbackToAdvanced: true }),
			axiosGet: async () => {
				standardCalls++;
				return response(503, "standard-failure");
			},
			advancedFetch: async () => {
				advancedCalls++;
				return response(200, "fallback-ok");
			},
		});
		expect(result.data).toBe("fallback-ok");
		expect(standardCalls).toBe(2);
		expect(advancedCalls).toBe(1);
		expect(
			result.attempts.map((attempt) => [attempt.mode, attempt.attempt]),
		).toEqual([
			["standard", 1],
			["standard", 2],
			["advanced", 3],
		]);

		for (const scenario of [
			"ordinary",
			"refusal",
			"cancelled",
			"deadline",
		] as const) {
			let fallbackCalls = 0;
			let standardCalls = 0;
			let deadlineCurrent = 0;
			const policy = basePolicy({
				retryCount: scenario === "ordinary" ? 3 : 0,
				fallbackToAdvanced: true,
				feedRunTimeoutMs: scenario === "deadline" ? 100 : 5_000,
			});
			const scenarioRun = execute({
				url: scenario === "refusal" ? "http://10.0.0.5/refusal" : PUBLIC_URL,
				outboundPolicy: { allowPrivateFetches: false, allowlist: [] },
				policy,
				now: scenario === "deadline" ? () => deadlineCurrent : undefined,
				signal:
					scenario === "cancelled"
						? (() => {
								const controller = new AbortController();
								controller.abort();
								return controller.signal;
							})()
						: undefined,
				axiosGet: async () => {
					standardCalls++;
					if (scenario === "ordinary") return response(404, "ordinary");
					if (scenario === "refusal") {
						await assertAndResolveOutboundTarget("http://10.0.0.5/refusal", {
							allowPrivateFetches: false,
							allowlist: [],
						});
					}
					if (scenario === "deadline") deadlineCurrent = 101;
					return response(503, "retryable");
				},
				advancedFetch: async () => {
					fallbackCalls++;
					return response(200, "must-not-run");
				},
			});
			if (scenario === "ordinary") {
				const ordinary = await scenarioRun;
				expect(ordinary.status).toBe(404);
				expect(fallbackCalls).toBe(0);
				continue;
			}
			const scenarioError = await failureOf(scenarioRun);
			expect(fallbackCalls).toBe(0);
			if (scenario === "refusal") expect(standardCalls).toBeLessThanOrEqual(1);
			if (scenario === "refusal")
				expectTyped(scenarioError, "FETCH_POLICY_REFUSED", ["10.0.0.5"]);
			expect(scenarioError).toBeDefined();
		}
	});

	test("A4/I2/E4: a failed fallback is attempted once and reports ordered sanitized evidence", async () => {
		let standardCalls = 0;
		let advancedCalls = 0;
		const fallbackSecret = "failed-fallback-solver-secret";
		const failedFallback = await failureOf(
			execute({
				url: "https://fallback.example/articles?token=fallback-query",
				policy: basePolicy({ retryCount: 1, fallbackToAdvanced: true }),
				axiosGet: async () => {
					standardCalls++;
					return response(503, "standard-fallback-body");
				},
				advancedFetch: async () => {
					advancedCalls++;
					throw new Error(`advanced failure ${fallbackSecret}`);
				},
			}),
		);
		expect(standardCalls).toBe(2);
		expect(advancedCalls).toBe(1);
		expectTyped(failedFallback, "FETCH_ADVANCED_FAILED", [
			fallbackSecret,
			"standard-fallback-body",
		]);
		const failedAttempts = attemptsOf(failedFallback);
		expect(failedAttempts).toHaveLength(3);
		expect(
			failedAttempts?.map((attempt) => [attempt.mode, attempt.attempt]),
		).toEqual([
			["standard", 1],
			["standard", 2],
			["advanced", 3],
		]);
		failedAttempts?.forEach((attempt, index) => {
			expectAttemptMetrics(
				attempt,
				index < 2 ? "FETCH_RETRYABLE_STATUS" : "FETCH_ADVANCED_FAILED",
			);
		});
	});

	test("A5: successful and ordinary-4xx results preserve data, status, final URL, headers, and evidence", async () => {
		const headers = { "content-type": "text/plain", "x-request-id": "req-42" };
		const success = await execute<string>({
			url: PUBLIC_URL,
			policy: basePolicy({ retryCount: 0 }),
			axiosGet: async () => response(200, "payload", headers),
		});
		expect(success).toMatchObject({
			data: "payload",
			status: 200,
			finalUrl: "https://example.com/final",
			headers,
		});
		expect(success.attempts[0]).toMatchObject({
			attempt: 1,
			mode: "standard",
			status: 200,
		});
		expectResultDuration(success);
		expectAttemptMetrics(success.attempts[0], "FETCH_SUCCESS");

		const ordinary = await execute<string>({
			url: PUBLIC_URL,
			policy: basePolicy({ retryCount: 3 }),
			axiosGet: async () => response(403, "ordinary-data", headers),
		});
		expect(ordinary).toMatchObject({
			data: "ordinary-data",
			status: 403,
			headers,
		});
		expect(ordinary.attempts).toHaveLength(1);
		expectResultDuration(ordinary);
		expectAttemptMetrics(ordinary.attempts[0], "FETCH_ORDINARY_4XX");
	});

	test("I1/I3: one deadline spans retries, backoff, and fallback, and both seams retain outbound policy", async () => {
		const policyOptions = {
			allowPrivateFetches: false,
			allowlist: ["example.com"],
		};
		let current = 0;
		const waits: number[] = [];
		const advancedBudgets: number[] = [];
		const standardPolicies: unknown[] = [];
		const result = await execute({
			url: PUBLIC_URL,
			policy: basePolicy({
				feedRunTimeoutMs: 100,
				retryCount: 1,
				retryBackoffMs: 20,
				fallbackToAdvanced: true,
			}),
			outboundPolicy: policyOptions,
			now: () => current,
			wait: async (ms: number) => {
				waits.push(ms);
				current += ms;
			},
			axiosGet: async (_url: string, _config: unknown, outbound: unknown) => {
				standardPolicies.push(outbound);
				return response(503, "retryable");
			},
			advancedFetch: async (request: AdvancedRequest) => {
				advancedBudgets.push(request.remainingMs ?? -1);
				expect(request.outboundPolicy).toBe(policyOptions);
				return response(200, "advanced-recovery");
			},
		});
		expect(result.data).toBe("advanced-recovery");
		expect(waits).toEqual([20]);
		expect(standardPolicies).toEqual([policyOptions, policyOptions]);
		expect(advancedBudgets).toEqual([80]);
	});

	test("I2/E4/E5: terminal failures have stable safe codes and never expose transport URLs, secrets, errors, or response bodies", async () => {
		const secrets = [
			"user-password",
			"token=private-query",
			"Bearer private-header",
			"cookie-secret",
			"proxy-password",
			"raw injected transport detail",
			"retry-response-body-secret",
		];
		const error = await failureOf(
			execute({
				url: "https://user-password@example.com/articles?token=private-query",
				policy: basePolicy({ retryCount: 1 }),
				axiosConfig: {
					headers: {
						Authorization: "Bearer private-header",
						Cookie: "session=cookie-secret",
					},
					proxy: {
						auth: { username: "proxy-user", password: "proxy-password" },
					},
				},
				axiosGet: async () => {
					throw new Error("raw injected transport detail");
				},
			}),
		);
		expectTyped(error, "FETCH_RETRY_EXHAUSTED", secrets);
		const terminalAttempts = attemptsOf(error);
		expect(terminalAttempts).toHaveLength(2);
		expect(terminalAttempts?.map((item) => item.attempt)).toEqual([1, 2]);
		terminalAttempts?.forEach((attempt) => {
			expectAttemptMetrics(attempt, "FETCH_TRANSPORT_ERROR");
		});

		const bodyError = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 0 }),
				axiosGet: async () => response(503, "retry-response-body-secret"),
			}),
		);
		expectTyped(bodyError, "FETCH_RETRY_EXHAUSTED", [
			"retry-response-body-secret",
		]);
		const bodyAttempts = attemptsOf(bodyError);
		expect(bodyAttempts).toHaveLength(1);
		bodyAttempts?.forEach((attempt) => {
			expectAttemptMetrics(attempt, "FETCH_RETRYABLE_STATUS");
		});
	});

	test("A5/I2/E4: recovered attempt evidence has exact codes, duration, and no URL or transport secrets", async () => {
		let recoveredCalls = 0;
		const recovered = await execute({
			url: "https://user-password@example.com/articles?token=private-query",
			policy: basePolicy({ retryCount: 1 }),
			axiosGet: async () => {
				recoveredCalls++;
				if (recoveredCalls === 1) throw new Error("recovered raw secret");
				return response(200, "recovered");
			},
		});
		expect(recovered.data).toBe("recovered");
		expectResultDuration(recovered);
		expect(recovered.attempts).toHaveLength(2);
		expect(String(recovered.attempts[0]?.error ?? "")).not.toContain(
			"recovered raw secret",
		);
		expect(JSON.stringify(recovered.attempts)).not.toContain("user-password");
		expect(JSON.stringify(recovered.attempts)).not.toContain(
			"token=private-query",
		);
		expectAttemptMetrics(recovered.attempts[0], "FETCH_TRANSPORT_ERROR");
		expectAttemptMetrics(recovered.attempts[1], "FETCH_SUCCESS");
	});

	test("E4: advanced failure is typed, sanitized, and represented by one terminal attempt", async () => {
		const solverSecret = "solver-pass-token";
		const advancedError = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({ mode: "advanced", retryCount: 0 }),
				axiosGet: async () => response(200, "wrong-standard"),
				advancedFetch: async () => {
					throw new Error(
						`solver endpoint https://solver:${solverSecret}@solver.invalid/v1 ${solverSecret}`,
					);
				},
			}),
		);
		expectTyped(advancedError, "FETCH_ADVANCED_FAILED", [
			solverSecret,
			"solver.invalid",
		]);
		const advancedAttempts = attemptsOf(advancedError);
		expect(advancedAttempts).toHaveLength(1);
		advancedAttempts?.forEach((attempt) => {
			expectAttemptMetrics(attempt, "FETCH_ADVANCED_FAILED");
		});
	});

	test("E1: exact resolver bounds are accepted and first-over values clamp", () => {
		const policy = resolveFetchPolicy({
			fetchPolicy: {
				feedRunTimeoutMs: 600_000,
				maxResponseSizeBytes: 20 * 1024 * 1024,
				maxRedirects: 10,
				retryCount: 5,
				retryBackoffMs: 30_000,
			},
		});
		expect(policy).toMatchObject({
			feedRunTimeoutMs: 600_000,
			maxResponseSizeBytes: 20 * 1024 * 1024,
			maxRedirects: 10,
			retryCount: 5,
			retryBackoffMs: 30_000,
		});
		const clamped = resolveFetchPolicy({
			fetchPolicy: {
				feedRunTimeoutMs: 600_001,
				maxResponseSizeBytes: 20 * 1024 * 1024 + 1,
				maxRedirects: 11,
				retryCount: 6,
				retryBackoffMs: 30_001,
			},
		});
		expect(clamped).toMatchObject({
			feedRunTimeoutMs: 600_000,
			maxResponseSizeBytes: 20 * 1024 * 1024,
			maxRedirects: 10,
			retryCount: 5,
			retryBackoffMs: 30_000,
		});
		expect(
			resolveFetchPolicy({ fetchPolicy: { feedRunTimeoutMs: 999 } })
				.feedRunTimeoutMs,
		).toBe(1_000);
		expect(
			resolveFetchPolicy({ fetchPolicy: { maxResponseSizeBytes: 65_535 } })
				.maxResponseSizeBytes,
		).toBe(64 * 1024);
		const lowerEdges = resolveFetchPolicy({
			fetchPolicy: {
				feedRunTimeoutMs: 1_000,
				maxResponseSizeBytes: 64 * 1024,
				maxRedirects: 0,
				retryCount: 0,
				retryBackoffMs: 0,
			},
		});
		expect(lowerEdges).toMatchObject({
			feedRunTimeoutMs: 1_000,
			maxResponseSizeBytes: 64 * 1024,
			maxRedirects: 0,
			retryCount: 0,
			retryBackoffMs: 0,
		});
		expect(
			resolveFetchPolicy({ fetchPolicy: { maxRedirects: -1 } }).maxRedirects,
		).toBe(0);
		expect(
			resolveFetchPolicy({ fetchPolicy: { retryCount: -1 } }).retryCount,
		).toBe(0);
		expect(
			resolveFetchPolicy({ fetchPolicy: { retryBackoffMs: -1 } })
				.retryBackoffMs,
		).toBe(0);
	});

	test("E2: cancellation before start, during transport, and during backoff is typed and starts no later attempt", async () => {
		const before = new AbortController();
		before.abort();
		let beforeCalls = 0;
		const beforeError = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 2 }),
				signal: before.signal,
				axiosGet: async () => {
					beforeCalls++;
					return response(200, "must-not-start");
				},
			}),
		);
		expect(beforeCalls).toBe(0);
		expectTyped(beforeError, "FETCH_CANCELLED");

		const active = new AbortController();
		let activeCalls = 0;
		let suppliedSignal: AbortSignal | undefined;
		const activeErrorPromise = execute({
			url: PUBLIC_URL,
			policy: basePolicy({ retryCount: 1 }),
			signal: active.signal,
			axiosGet: async (_url: string, config: { signal?: AbortSignal }) => {
				activeCalls++;
				suppliedSignal = config.signal;
				if (!suppliedSignal)
					throw new Error("transport received no caller signal");
				return new Promise<never>((_resolve, reject) => {
					suppliedSignal?.addEventListener(
						"abort",
						() => reject(new Error("active request interrupted")),
						{ once: true },
					);
					queueMicrotask(() => active.abort());
				});
			},
		});
		const activeError = await failureOf(activeErrorPromise);
		expect(activeCalls).toBe(1);
		expect(suppliedSignal).toBe(active.signal);
		expectTyped(activeError, "FETCH_CANCELLED");

		const backoff = new AbortController();
		let backoffCalls = 0;
		const backoffError = await failureOf(
			execute({
				url: PUBLIC_URL,
				policy: basePolicy({ retryCount: 1, retryBackoffMs: 1 }),
				signal: backoff.signal,
				axiosGet: async () => {
					backoffCalls++;
					queueMicrotask(() => backoff.abort());
					return response(503, "backoff");
				},
				wait: async (_ms: number, signal?: AbortSignal) => {
					if (signal?.aborted) throw new Error("backoff interrupted");
					return new Promise<void>((_resolve, reject) =>
						signal?.addEventListener(
							"abort",
							() => reject(new Error("backoff interrupted")),
							{ once: true },
						),
					);
				},
			}),
		);
		expect(backoffCalls).toBe(1);
		expectTyped(backoffError, "FETCH_CANCELLED");
	});

	test("E3/I1: before-request, in-request, backoff, and fallback deadline exhaustion are typed and deterministic", async () => {
		const cases = [
			{ name: "before", initial: 0, expectedCalls: 0 },
			{ name: "request", initial: 0, expectedCalls: 1 },
			{ name: "backoff", initial: 0, expectedCalls: 1 },
			{ name: "fallback", initial: 0, expectedCalls: 1 },
		] as const;
		for (const scenario of cases) {
			let current = scenario.initial;
			let nowCalls = 0;
			let calls = 0;
			let advancedCalls = 0;
			const beforeRequest = scenario.name === "before";
			const error = await failureOf(
				execute({
					url: PUBLIC_URL,
					policy: basePolicy({
						feedRunTimeoutMs: 100,
						retryCount: scenario.name === "backoff" ? 1 : 0,
						retryBackoffMs: 10,
						fallbackToAdvanced: scenario.name === "fallback",
					}),
					now: () => {
						nowCalls++;
						if (beforeRequest) return nowCalls === 1 ? 0 : 100;
						return current;
					},
					wait: async (ms: number) => {
						current += ms;
					},
					axiosGet: async () => {
						calls++;
						if (scenario.name === "request") current = 101;
						if (scenario.name === "backoff") current = 95;
						if (scenario.name === "fallback") current = 100;
						return response(503, "deadline-response");
					},
					advancedFetch: async () => {
						advancedCalls++;
						return response(200, "must-not-fallback");
					},
				}),
			);
			if (beforeRequest) expect(calls).toBe(0);
			else expect(calls).toBe(scenario.expectedCalls);
			expect(advancedCalls).toBe(0);
			expectTyped(error, "FETCH_DEADLINE_EXCEEDED");
		}

		let exactCurrent = 0;
		const exact = await execute({
			url: PUBLIC_URL,
			policy: basePolicy({ feedRunTimeoutMs: 100, retryCount: 0 }),
			now: () => exactCurrent,
			axiosGet: async () => {
				exactCurrent = 100;
				return response(200, "exact-deadline-success");
			},
		});
		expect(exact.data).toBe("exact-deadline-success");
	});

	test("I4: concurrent executions keep attempt counts, waits, and cancellation operation-local", async () => {
		const cancelled = new AbortController();
		const waits: string[] = [];
		let firstCalls = 0;
		let secondCalls = 0;
		const firstPromise = execute({
			url: "https://example.com/first",
			policy: basePolicy({ retryCount: 1, retryBackoffMs: 1 }),
			signal: cancelled.signal,
			axiosGet: async () => {
				firstCalls++;
				if (firstCalls === 1) {
					cancelled.abort();
					return response(503, "first");
				}
				return response(200, "must-not-run");
			},
			wait: async (ms: number) => waits.push(`first:${ms}`),
		});
		const secondPromise = execute({
			url: "https://example.com/second",
			policy: basePolicy({ retryCount: 1, retryBackoffMs: 2 }),
			axiosGet: async () => {
				secondCalls++;
				return response(secondCalls === 1 ? 503 : 200, "second-ok");
			},
			wait: async (ms: number) => waits.push(`second:${ms}`),
		});
		const [firstError, second] = await Promise.all([
			failureOf(firstPromise),
			secondPromise,
		]);
		expectTyped(firstError, "FETCH_CANCELLED");
		expect(second.data).toBe("second-ok");
		expect(firstCalls).toBe(1);
		expect(secondCalls).toBe(2);
		expect(waits).toEqual(["second:2"]);
	});

	test("A6: simple and form web-scraping requests preserve method, body, headers, cookies, and policy through the shared executor", async () => {
		const requests: Array<{
			method: string;
			url: string;
			body: string;
			headers: Headers;
		}> = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				requests.push({
					method: request.method,
					url: request.url,
					body: await request.text(),
					headers: request.headers,
				});
				return new Response("<html><body>scrape-ok</body></html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				});
			},
		});
		cleanups.push(() => server.stop(true));
		const baseUrl = `http://127.0.0.1:${server.port}/search`;
		const policyOptions = {
			allowlist: ["127.0.0.1"],
			allowPrivateFetches: false,
		};

		const simple = await fetchWebScrapingHtml({
			feedConfig: {
				feedId: "simple",
				feedName: "Simple",
				feedType: "webScraping",
				refreshTime: 5,
				config: { baseUrl },
				article: {},
			} as unknown as WebScrapingFeedConfig,
			policyOptions,
			headers: { "X-Request-Profile": "profile-value" },
			cookieString: "session=cookie-value",
		});
		expect(simple.html).toContain("scrape-ok");
		expect(requests[0]).toMatchObject({ method: "GET", body: "" });
		expect(requests[0].headers.get("x-request-profile")).toBe("profile-value");
		expect(requests[0].headers.get("cookie")).toBe("session=cookie-value");

		const form = await fetchWebScrapingHtml({
			feedConfig: {
				feedId: "form",
				feedName: "Form",
				feedType: "webScraping",
				refreshTime: 5,
				config: {
					baseUrl,
					request: {
						mode: "form",
						method: "POST",
						actionUrl: baseUrl,
						fields: { q: "cats", page: "2" },
					},
				},
				article: {},
			} as unknown as WebScrapingFeedConfig,
			policyOptions,
			headers: { "X-Request-Profile": "profile-value" },
			cookieString: "session=cookie-value",
		});
		expect(form.html).toContain("scrape-ok");
		expect(requests[1]).toMatchObject({
			method: "POST",
			body: "q=cats&page=2",
		});
		expect(requests[1].headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
	});

	test("A6: explicit advanced web-scraping mode reaches the approved solver path instead of standard transport", async () => {
		const targetRequests: string[] = [];
		const target = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				targetRequests.push(request.method);
				return new Response("standard-target-must-not-run", { status: 200 });
			},
		});
		const solverPayloads: Array<Record<string, unknown>> = [];
		const solver = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				solverPayloads.push((await request.json()) as Record<string, unknown>);
				return Response.json({
					solution: { status: 200, response: "advanced-solver-result" },
				});
			},
		});
		cleanups.push(() => target.stop(true));
		cleanups.push(() => solver.stop(true));
		const targetUrl = `http://127.0.0.1:${target.port}/page`;
		const solverUrl = `http://127.0.0.1:${solver.port}`;
		const result = await fetchWebScrapingHtml({
			feedConfig: {
				feedId: "advanced",
				feedName: "Advanced",
				feedType: "webScraping",
				refreshTime: 5,
				fetchPolicy: { mode: "advanced", retryCount: 0 },
				flaresolverr: { enabled: true, serverUrl: solverUrl, timeout: 2_000 },
				config: { baseUrl: targetUrl },
				article: {},
			} as unknown as WebScrapingFeedConfig,
			policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			cookieString: "session=advanced-cookie",
		});
		expect(result.html).toContain("advanced-solver-result");
		expect(targetRequests).toEqual([]);
		expect(solverPayloads).toHaveLength(1);
		expect(solverPayloads[0]?.url).toBe(targetUrl);
		expect(solverPayloads[0]?.cookies).toEqual([
			{ name: "session", value: "advanced-cookie" },
		]);
	});

	test("A6: configured fallback uses one solver attempt, preserves cookies, and reports missing solver configuration safely", async () => {
		const fallbackTargetRequests: string[] = [];
		const fallbackTarget = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				fallbackTargetRequests.push(request.method);
				return new Response("standard-retryable", { status: 503 });
			},
		});
		const fallbackPayloads: Array<Record<string, unknown>> = [];
		const fallbackSolver = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				fallbackPayloads.push(
					(await request.json()) as Record<string, unknown>,
				);
				return Response.json({
					solution: { status: 200, response: "configured-fallback" },
				});
			},
		});
		cleanups.push(() => fallbackTarget.stop(true));
		cleanups.push(() => fallbackSolver.stop(true));
		const targetUrl = `http://127.0.0.1:${fallbackTarget.port}/page`;
		const solverUrl = `http://127.0.0.1:${fallbackSolver.port}`;
		const result = await fetchWebScrapingHtml({
			feedConfig: {
				feedId: "fallback",
				feedName: "Fallback",
				feedType: "webScraping",
				refreshTime: 5,
				fetchPolicy: { retryCount: 0, fallbackToAdvanced: true },
				flaresolverr: { enabled: true, serverUrl: solverUrl, timeout: 2_000 },
				config: { baseUrl: targetUrl },
				article: {},
			} as unknown as WebScrapingFeedConfig,
			policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			cookieString: "session=fallback-cookie",
		});
		expect(result.html).toContain("configured-fallback");
		expect(fallbackTargetRequests).toEqual(["GET"]);
		expect(fallbackPayloads).toHaveLength(1);
		expect(fallbackPayloads[0]?.cookies).toEqual([
			{ name: "session", value: "fallback-cookie" },
		]);

		const missingTargetRequests: string[] = [];
		const missingTarget = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				missingTargetRequests.push(request.method);
				return new Response("missing-solver-target", {
					status: new URL(request.url).pathname === "/fallback" ? 503 : 200,
				});
			},
		});
		cleanups.push(() => missingTarget.stop(true));
		const missingUrl = `http://127.0.0.1:${missingTarget.port}/page`;
		const missingError = await failureOf(
			fetchWebScrapingHtml({
				feedConfig: {
					feedId: "missing-solver",
					feedName: "Missing Solver",
					feedType: "webScraping",
					refreshTime: 5,
					fetchPolicy: { mode: "advanced", retryCount: 0 },
					config: { baseUrl: missingUrl },
					article: {},
				} as unknown as WebScrapingFeedConfig,
				policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			}),
		);
		expectTyped(missingError, "FETCH_ADVANCED_UNAVAILABLE");
		expect(missingTargetRequests).toEqual([]);

		const missingFallbackError = await failureOf(
			fetchWebScrapingHtml({
				feedConfig: {
					feedId: "missing-fallback-solver",
					feedName: "Missing Fallback Solver",
					feedType: "webScraping",
					refreshTime: 5,
					fetchPolicy: { retryCount: 0, fallbackToAdvanced: true },
					config: {
						baseUrl: `http://127.0.0.1:${missingTarget.port}/fallback`,
					},
					article: {},
				} as unknown as WebScrapingFeedConfig,
				policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			}),
		);
		expectTyped(missingFallbackError, "FETCH_ADVANCED_UNAVAILABLE");
		expect(missingTargetRequests).toEqual(["GET"]);
	});

	test("A7: existing-feed and Source Assistant integrations share retry behavior with local deterministic transports", async () => {
		let rssCalls = 0;
		let sourceCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				if (new URL(request.url).pathname === "/rss") {
					rssCalls++;
					if (rssCalls === 1) return new Response("retry-rss", { status: 503 });
					return new Response(
						"<rss><channel><title>Retry RSS</title><item><guid>r1</guid><title>Item</title></item></channel></rss>",
						{
							status: 200,
							headers: { "content-type": "application/rss+xml" },
						},
					);
				}
				sourceCalls++;
				if (sourceCalls === 1)
					return new Response("retry-source", { status: 503 });
				return new Response(
					"<html><head><title>Source</title></head><body></body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html" },
					},
				);
			},
		});
		cleanups.push(() => server.stop(true));
		const policyOptions = {
			allowlist: ["127.0.0.1"],
			allowPrivateFetches: false,
		};
		const parsed = await parseExistingFeed({
			url: `http://127.0.0.1:${server.port}/rss`,
			format: "rss",
			policyOptions,
		});
		const observed = await observeSource(
			{ url: `http://127.0.0.1:${server.port}/source` },
			{ policyOptions },
		);
		expect(parsed.feed.title).toBe("Retry RSS");
		expect(parsed.items).toHaveLength(1);
		expect(observed.status).toBe(200);
		expect(observed.html?.title).toBe("Source");
		expect(rssCalls).toBe(2);
		expect(sourceCalls).toBe(2);
	});
});

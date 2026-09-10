import type { Context, MiddlewareHandler, Next } from "hono";

/**
 * Hard inbound byte ceilings. These are intentionally deployment constants,
 * not request-controlled settings: a client must never be able to make its
 * own request more expensive by selecting a larger limit.
 */
export const REQUEST_BODY_LIMITS = {
	fallback: 1024 * 1024,
	stateChanging: 256 * 1024,
	webhook: 64 * 1024,
	passkey: 8 * 1024,
} as const;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WEBHOOK_INGRESS_PATH = /^\/webhook-feeds\/[^/]+\/?$/;

/**
 * Resolve the strictest applicable class from trusted request metadata only.
 */
export function requestBodyLimitFor(method: string, path: string): number {
	const normalizedMethod = method.toUpperCase();
	if (normalizedMethod === "POST" && path === "/passkey") {
		return REQUEST_BODY_LIMITS.passkey;
	}
	if (normalizedMethod === "POST" && WEBHOOK_INGRESS_PATH.test(path)) {
		return REQUEST_BODY_LIMITS.webhook;
	}
	if (STATE_CHANGING_METHODS.has(normalizedMethod)) {
		return REQUEST_BODY_LIMITS.stateChanging;
	}
	return REQUEST_BODY_LIMITS.fallback;
}

function payloadTooLarge(c: Context): Response {
	return c.text("Payload Too Large", 413);
}

function malformedLength(c: Context): Response {
	return c.text("Malformed Content-Length", 400);
}

function parseContentLength(value: string): bigint | null {
	const normalized = value.trim();
	if (!/^\d+$/.test(normalized)) return null;
	try {
		return BigInt(normalized);
	} catch {
		return null;
	}
}

function replayBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

/**
 * Enforce a byte ceiling before any route-level body parser runs.
 *
 * A trustworthy Content-Length permits an immediate refusal, but accepted
 * requests are still measured while reading. Unknown/chunked requests are
 * stopped at the first byte over the limit. At most one applicable limit is
 * buffered, and accepted bytes are replayed unchanged to Hono's parsers.
 */
export function requestBodyLimit(): MiddlewareHandler {
	return async (c: Context, next: Next) => {
		const maxSize = requestBodyLimitFor(c.req.method, c.req.path);
		const contentLengthHeader = c.req.raw.headers.get("content-length");
		const transferEncoding = c.req.raw.headers.get("transfer-encoding");

		// Both headers make the message framing ambiguous. Bun rejects this at
		// the socket boundary today; retain the same fail-closed behavior for
		// programmatic Requests or future runtimes that pass it through.
		if (contentLengthHeader !== null && transferEncoding !== null) {
			return malformedLength(c);
		}

		if (contentLengthHeader !== null) {
			const declaredLength = parseContentLength(contentLengthHeader);
			if (declaredLength === null) return malformedLength(c);
			if (declaredLength > BigInt(maxSize)) return payloadTooLarge(c);
		}

		// Bun deliberately exposes no Fetch body stream for GET/HEAD even when
		// the peer sends framing metadata. The validated header still lets us
		// reject a known oversized request; there is nothing a downstream Hono
		// parser could consume or that this middleware can replay otherwise.
		const rawBody = c.req.raw.body;
		if (!rawBody) return next();

		const reader = rawBody.getReader();
		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				receivedBytes += value.byteLength;
				if (receivedBytes > maxSize) {
					// Stop upstream delivery immediately. Do not await cancellation:
					// some transports resolve it only after the peer closes, while the
					// security contract requires the 413 before end-of-stream.
					void reader.cancel().catch(() => undefined);
					return payloadTooLarge(c);
				}
				chunks.push(value);
			}
		} catch {
			return c.text("Invalid request body", 400);
		} finally {
			reader.releaseLock();
		}

		const requestInit: RequestInit & { duplex: "half" } = {
			body: replayBody(chunks),
			duplex: "half",
		};
		c.req.raw = new Request(c.req.raw, requestInit);
		return next();
	};
}

/**
 * The one approved low-level outbound HTTP primitive.
 *
 * This module deliberately lives under `lib/` rather than `utilities/`. The
 * architecture gate in `tests/outbound-network-primitives-architecture.test.ts`
 * scans `routes/`, `utilities/`, `workers/` and `node/` and refuses any direct
 * `axios`/`fetch` call there that is not on its exception ledger. Keeping the
 * primitive outside those directories is what lets that rule be absolute
 * inside them: application code has no direct network access at all, and the
 * one place that does is small enough to read in a sitting.
 *
 * Nothing here decides policy. Validation happens in
 * `utilities/outbound-fetch-policy.utility.ts`; this module only carries out a
 * request that has already been approved, against the address that was
 * approved.
 */

import axios from "axios";
import * as net from "node:net";

/**
 * Rewrites a URL to connect to an already-validated address while preserving
 * the original hostname in the `Host` header.
 *
 * Node's agent `lookup` hook would be the tidier mechanism, but Bun ignores
 * it — verified directly on this runtime: a `node:http.Agent({ lookup })`
 * pointed at an unresolvable hostname still fails with ECONNREFUSED rather
 * than dialling the supplied address. Rewriting the authority is what
 * actually pins the socket here.
 *
 * HTTPS is deliberately left unpinned (CF-12). Rewriting the authority for
 * TLS would present the IP as the SNI and break certificate validation;
 * doing it properly requires driving the connection target and `servername`
 * apart. HTTPS URLs are still fully validated — only the pin is missing — so
 * this narrows the time-of-check/time-of-use gap rather than closing it.
 */
export function pinUrlToAddress(
	url: string,
	address: string | undefined,
): { url: string; hostHeader?: string } {
	if (!address) return { url };

	const parsed = new URL(url);
	if (parsed.protocol !== "http:") return { url };
	if (parsed.hostname === address) return { url };

	const hostHeader = parsed.host; // hostname plus port, as sent on the wire
	parsed.hostname = net.isIPv6(address) ? `[${address}]` : address;
	return { url: parsed.toString(), hostHeader };
}

/**
 * Issues one request against the validated address.
 *
 * `deadlineAt` is a whole-operation budget, not a per-request one: it is
 * recomputed on every hop so a chain of slow redirects cannot multiply a
 * per-hop timeout into an unbounded total.
 */
export async function requestPinnedAddress(
	url: string,
	address: string | undefined,
	config: import("axios").AxiosRequestConfig,
	deadlineAt: number | undefined,
): Promise<import("axios").AxiosResponse> {
	const next: import("axios").AxiosRequestConfig = { ...config, maxRedirects: 0 };

	if (deadlineAt !== undefined) {
		const remainingMs = deadlineAt - Date.now();
		if (remainingMs <= 0) throw new Error("Outbound fetch deadline exceeded.");
		next.timeout = Math.min(remainingMs, Number(config.timeout ?? remainingMs));
	}

	const pinned = pinUrlToAddress(url, address);
	if (pinned.hostHeader) {
		next.headers = { ...(next.headers ?? {}), Host: pinned.hostHeader };
	}

	return axios.get(pinned.url, next);
}

/**
 * The general form: issues one request from a caller-supplied axios config,
 * for the flows that need a method other than GET and a request body.
 *
 * `config.url` is ignored in favour of the pinned URL, so a caller cannot
 * accidentally send to an unvalidated target by setting it.
 */
export async function requestPinnedWithConfig(
	url: string,
	address: string | undefined,
	config: import("axios").AxiosRequestConfig,
	deadlineAt?: number,
): Promise<import("axios").AxiosResponse> {
	const next: import("axios").AxiosRequestConfig = { ...config, maxRedirects: 0 };

	if (deadlineAt !== undefined) {
		const remainingMs = deadlineAt - Date.now();
		if (remainingMs <= 0) throw new Error("Outbound fetch deadline exceeded.");
		next.timeout = Math.min(remainingMs, Number(config.timeout ?? remainingMs));
	}

	const pinned = pinUrlToAddress(url, address);
	if (pinned.hostHeader) {
		next.headers = { ...(next.headers ?? {}), Host: pinned.hostHeader };
	}
	next.url = pinned.url;

	return axios(next);
}

/**
 * The POST equivalent, for the endpoints that are genuinely request/response
 * rather than fetches — GraphQL, chiefly.
 *
 * Redirects are not followed: a POST that redirects is not something any
 * caller here needs, and following one would need the same revalidation
 * machinery the GET path has. `maxRedirects: 0` makes that explicit rather
 * than incidental.
 */
export async function postPinnedAddress(
	url: string,
	address: string | undefined,
	data: unknown,
	config: import("axios").AxiosRequestConfig,
	deadlineAt?: number,
): Promise<import("axios").AxiosResponse> {
	const next: import("axios").AxiosRequestConfig = { ...config, maxRedirects: 0 };

	if (deadlineAt !== undefined) {
		const remainingMs = deadlineAt - Date.now();
		if (remainingMs <= 0) throw new Error("Outbound fetch deadline exceeded.");
		next.timeout = Math.min(remainingMs, Number(config.timeout ?? remainingMs));
	}

	const pinned = pinUrlToAddress(url, address);
	if (pinned.hostHeader) {
		next.headers = { ...(next.headers ?? {}), Host: pinned.hostHeader };
	}

	return axios.post(pinned.url, data, next);
}

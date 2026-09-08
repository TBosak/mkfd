import axios from "axios";
import { axiosGetWithPolicyRedirects } from "./feed-config-route-adapter.utility";
import { getGlobalFetchPolicyOptions } from "./outbound-fetch-policy.utility";
import { solveWithFlareSolverr } from "../lib/outbound/flaresolverr-adapter";
import { openBrowserSession, type BrowserSession } from "../lib/outbound/browser-adapter";
import { resolveFetchPolicy } from "./fetch-policy.utility";
import dayjs from "dayjs";
import * as cheerio from "cheerio";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { Cookie } from "patchright";
import { discoverUrl, looksLikeUrl } from "./url-discovery.utility";

dayjs.extend(customParseFormat);

function stripHtml(html: string) {
	return html.replace(/<(?:.|\n)*?>/gm, "");
}

function titleCase(words: string) {
	return words.replace(
		/\w\S*/g,
		(txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase(),
	);
}

function appendUrl(url?: string, link?: string) {
	if (url && link) {
		if (link.startsWith("/")) {
			return url.endsWith("/")
				? `${url.substring(0, url.length - 1)}${link}`
				: `${url}${link}`;
		}
		return url.endsWith("/") ? `${url}${link}` : `${url}/${link}`;
	}
}

export function processWords(
	words?: string,
	title?: boolean,
	removeHtml?: boolean,
) {
	var result = words ?? "";
	if (removeHtml) result = stripHtml(result);
	if (title) result = titleCase(result);
	return result;
}

export function processLinks(
	words?: string,
	removeHtml?: boolean,
	relativeLink?: boolean,
	rootUrl?: string,
) {
	var result = words ?? "";
	if (removeHtml) result = stripHtml(result);
	if (relativeLink && rootUrl) result = appendUrl(rootUrl, result) ?? result;
	return result;
}

export type ParsedDate = { date: Date; isFallback: boolean };

export function processDates(
	date?: any,
	removeHtml?: boolean,
	userDateFormat?: string,
): ParsedDate {
	let result = date ?? "";
	if (removeHtml) result = stripHtml(result);

	// If already a Date object, return it
	if (result instanceof Date) {
		return { date: result, isFallback: false };
	}

	if (userDateFormat) {
		const parsed = dayjs(result, userDateFormat);
		if (parsed.isValid()) return { date: parsed.toDate(), isFallback: false };
	}

	const patterns = [
		{ regex: /\b\d{10}\b/, type: "unix" },
		{ regex: /\b\d{13}\b/, type: "unixMillis" },
		{
			regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/,
			type: "iso",
		},
		{ regex: /\b\d{4}-\d{2}-\d{2}\b/, type: "yyyy-mm-dd" },
		{
			regex: /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/,
			type: "yyyy-mm-dd hh:mm:ss",
		},
		{
			regex: /\b\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT\b/,
			type: "utc",
		},
	];

	function parseDate(value: string, type: string): Date | null {
		switch (type) {
			case "unix":
				return new Date(parseInt(value, 10) * 1000);
			case "unixMillis":
				return new Date(parseInt(value, 10));
			case "iso":
				return new Date(value);
			case "yyyy-mm-dd":
				return new Date(`${value}T00:00:00Z`);
			case "yyyy-mm-dd hh:mm:ss":
				return new Date(`${value}Z`);
			case "utc":
				return new Date(value);
			default:
				return null;
		}
	}

	for (const { regex, type } of patterns) {
		const match = result.match(regex);
		if (match) {
			const parsedDate = parseDate(match[0], type);
			if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
				return { date: parsedDate, isFallback: false };
			}
		}
	}

	// Fallback: try to parse with Date constructor or return current date
	const fallbackDate = new Date(result);
	if (!Number.isNaN(fallbackDate.getTime())) {
		return { date: fallbackDate, isFallback: false };
	}

	return { date: new Date(), isFallback: true };
}

type WidenDefault<DefaultValue> = DefaultValue extends string
	? string
	: DefaultValue extends number
		? number
		: DefaultValue extends boolean
			? boolean
			: DefaultValue extends readonly unknown[]
				? unknown[]
				: DefaultValue;

export function get<DefaultValue>(
	obj: unknown,
	path: string | undefined,
	defaultValue: DefaultValue,
): WidenDefault<DefaultValue> {
	if (!path || typeof path !== "string")
		return defaultValue as WidenDefault<DefaultValue>;
	const keys = path.split(".");
	let result: unknown = obj;
	for (const key of keys) {
		if (!result || typeof result !== "object" || !(key in result)) {
			return defaultValue as WidenDefault<DefaultValue>;
		}
		result = (result as Record<string, unknown>)[key];
	}
	return result as WidenDefault<DefaultValue>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function resolveDrillChain(
	startingHtmlOrUrl: string,
	chain: Array<{
		selector: string;
		attribute: string;
		isRelative: boolean;
		baseUrl: string;
		stripHtml: boolean;
	}>,
	useAdvanced: boolean = false,
	expectUrl: boolean = false,
	flaresolverr?: {
		enabled?: boolean;
		serverUrl?: string;
		timeout?: number;
	},
	cookies?: Array<{ name: string; value: string }>,
): Promise<string> {
	if (!chain || chain.length === 0) return "";

	let currentHtml = "";
	let session: BrowserSession | null = null;

	try {
		if (
			startingHtmlOrUrl.startsWith("http://") ||
			startingHtmlOrUrl.startsWith("https://")
		) {
			if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
				// Routed through the one approved FlareSolverr adapter. This call
				// site used to POST straight to a feed-author-supplied serverUrl
				// with no outbound-policy check at all.
				try {
					const solved = await solveWithFlareSolverr({
						serverUrl: flaresolverr.serverUrl,
						targetUrl: startingHtmlOrUrl,
						maxTimeoutMs: flaresolverr.timeout || 60000,
						cookies: cookies ?? [],
						policyOptions: getGlobalFetchPolicyOptions(),
						budgetMs: resolveFetchPolicy().feedRunTimeoutMs,
					});
					currentHtml = solved.html;
				} catch (err) {
					console.warn(
						"resolveDrillChain: FlareSolverr error for",
						startingHtmlOrUrl,
						errorMessage(err),
					);
					return "";
				}
			} else if (useAdvanced) {
				// Routed through the one approved browser adapter. One session
				// spans the whole chain — and therefore one budget — while every
				// navigation and subresource is validated on its own. Cookies are
				// deliberately not passed: this branch has never applied them,
				// and starting to would change which hosts receive a user's
				// session cookie (CF-14).
				try {
					session = await openBrowserSession({
						url: startingHtmlOrUrl,
						policyOptions: getGlobalFetchPolicyOptions(),
						budgetMs: resolveFetchPolicy().feedRunTimeoutMs,
					});
					currentHtml = await session.navigate(startingHtmlOrUrl);
				} catch (err) {
					// Returns "" rather than propagating, matching the two sibling
					// branches: resolveDrillChain is best-effort for every other
					// kind of starting URL, and a refusal here should not be the
					// one case that fails the whole feed build.
					console.warn(
						"resolveDrillChain: browser fetch failed for",
						startingHtmlOrUrl,
						errorMessage(err),
					);
					return "";
				}
			} else {
				try {
					const resp = await axiosGetWithPolicyRedirects(
						startingHtmlOrUrl,
						{
							maxContentLength: 2 * 1024 * 1024,
							maxBodyLength: 2 * 1024 * 1024,
						},
						getGlobalFetchPolicyOptions(),
					);
					currentHtml = resp.data;
				} catch (err) {
					console.warn(
						"resolveDrillChain: Skipped large or failed fetch for",
						startingHtmlOrUrl,
						errorMessage(err),
					);
					return "";
				}
			}
		} else {
			currentHtml = startingHtmlOrUrl;
		}

		let finalValue = "";

		console.log(`[DrillChain] Processing ${chain.length} step(s)`);
		for (let i = 0; i < chain.length; i++) {
			const { selector, attribute, isRelative, baseUrl } = chain[i];
			console.log(
				`[DrillChain] Step ${i + 1}: selector="${selector}", attribute="${attribute}"`,
			);
			const $ = cheerio.load(currentHtml);
			const el = $(selector).first();
			if (!el || el.length === 0) {
				console.log(`[DrillChain] Step ${i + 1}: Selector not found, breaking`);
				finalValue = "";
				break;
			}
			console.log(`[DrillChain] Step ${i + 1}: Selector found`);

			const rawValue = attribute
				? (el.attr(attribute) ?? "")
				: chain[i].stripHtml
					? (el.text() ?? "")
					: (el.html() ?? "");

			if (i === chain.length - 1) {
				let val = rawValue;

				if (expectUrl && !looksLikeUrl(val)) {
					const $frag = cheerio.load(val); // rawValue might be HTML
					const mined = discoverUrl($frag, $frag.root());
					if (mined) val = mined;
				}

				finalValue = val;
			} else {
				let absoluteUrl = rawValue;
				if (isRelative && baseUrl) {
					absoluteUrl =
						baseUrl.endsWith("/") || rawValue.startsWith("/")
							? baseUrl + rawValue
							: `${baseUrl}/${rawValue}`;
					console.log(
						`[DrillChain] Resolved relative URL: ${rawValue} -> ${absoluteUrl}`,
					);
				}

				if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
					// Routed through the one approved FlareSolverr adapter, as above.
					try {
						console.log(`[DrillChain] Using FlareSolverr for: ${absoluteUrl}`);
						const solved = await solveWithFlareSolverr({
							serverUrl: flaresolverr.serverUrl,
							targetUrl: absoluteUrl,
							maxTimeoutMs: flaresolverr.timeout || 60000,
							cookies: cookies ?? [],
							policyOptions: getGlobalFetchPolicyOptions(),
							budgetMs: resolveFetchPolicy().feedRunTimeoutMs,
						});
						currentHtml = solved.html;
					} catch (err) {
						console.warn(
							"resolveDrillChain: FlareSolverr error for step",
							absoluteUrl,
							errorMessage(err),
						);
						finalValue = "";
						break;
					}
				} else if (useAdvanced && session) {
					try {
						console.log(`[DrillChain] Navigating to: ${absoluteUrl}`);
						// absoluteUrl comes out of the previously scraped page, so
						// it is attacker-influenced input. Before this slice this
						// branch navigated to it with no validation at all, while
						// the two branches beside it validated the same value.
						currentHtml = await session.navigate(absoluteUrl);
					} catch {
						finalValue = "";
						break;
					}
				} else {
					try {
						const resp = await axiosGetWithPolicyRedirects(
							absoluteUrl,
							{
								maxContentLength: 2 * 1024 * 1024,
								maxBodyLength: 2 * 1024 * 1024,
							},
							getGlobalFetchPolicyOptions(),
						);
						currentHtml = resp.data;
					} catch (err) {
						console.warn(
							"resolveDrillChain: Skipped large or failed fetch for",
							absoluteUrl,
							errorMessage(err),
						);
						finalValue = "";
						break;
					}
				}
			}
		}

		return finalValue;
	} finally {
		if (session) await session.close();
	}
}

export function parseCookiesForPlaywright(
	cookieString: string,
	domain: string,
): Cookie[] {
	return cookieString.split(";").map((part) => {
		const [name, ...valuePieces] = part.trim().split("=");
		return {
			name,
			value: valuePieces.join("="),
			domain, // or supply `url: feedConfig.config.baseUrl`
			path: "/",
		} as Cookie;
	});
}

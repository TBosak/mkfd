import axios, { type AxiosRequestConfig } from "axios";
import {
	buildFeedObject,
	buildFeedObjectFromApiData,
} from "../utilities/rss-builder.utility";
import {
	writeAllFeedFormats,
	serializeAllFeedFormats,
	extractFeedItemSnapshots,
} from "../utilities/feed-output.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
// parseCookiesForPlaywright might be simplified or removed if cookies are directly structured correctly
// import { parseCookiesForPlaywright } from "../utilities/data-handler.utility"
import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "../utilities/chrome-extensions.utility";
import { getRandomUserAgent } from "../utilities/user-agents.utility";
import {
	loadDateIndex,
	saveDateIndex,
	storeFeedHistory,
} from "../utilities/feed-history.utility";
import { resolveProtectedValues } from "../utilities/protected-values.utility";
import {
	assertOutboundFetchAllowed,
	mergeFeedPolicyOptions,
	parseAllowlist,
	type OutboundFetchPolicyOptions,
} from "../utilities/outbound-fetch-policy.utility";
import { runFeedTransformer } from "../utilities/feed-transformer.utility";
import { requestWithPolicyRedirects } from "../utilities/feed-config-route-adapter.utility";
import { solveWithFlareSolverr } from "../lib/outbound/flaresolverr-adapter";
import { resolveFetchPolicy } from "../utilities/fetch-policy.utility";
import { getFeedSourceDefinition } from "../utilities/feed-source-registry.utility";
import { fetchWebScrapingHtml } from "../utilities/web-scraping-fetcher.utility";
import { initDb } from "../lib/analytics/db";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";
import { fetchAndBuildSitemapItems } from "../utilities/sitemap.utility";
import { fetchAndBuildCalendarItems } from "../utilities/calendar-feed.utility";
import {
	executeGraphQLFeed,
	buildGraphQLItems,
} from "../utilities/graphql-feed.utility";
import {
	readWebhookEvents,
	buildWebhookItems,
} from "../utilities/webhook-feed.utility";
import { scanFilesystemFeed } from "../utilities/filesystem-feed.utility";
import { runServiceConnector } from "../utilities/service-connector-runner.utility";
import {
	loadServiceConnectorState,
	saveServiceConnectorState,
} from "../utilities/service-connector-state.utility";
import { getDb } from "../lib/analytics/db";

declare var self: Worker;
initDb();
const rssDir = "./public/feeds";

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}


async function fetchDataAndUpdateFeed(rawConfig: Record<string, unknown>) {
	const feedConfig = normalizeLoadedFeedConfig(rawConfig);
	const encKey = process.env.ENCRYPTION_KEY ?? "";
	const startedAt = Date.now();
	let httpStatus: number | null = null;
	let timedOut = false;
	let lastBuildResult:
		| import("../utilities/rss-builder.utility").BuildRSSResult
		| null = null;
	let lastWebhookStatus: "success" | "failed" | "skipped" | null = null;
	let lastWebhookError: string | null = null;

	try {
		let lastFeedObject: import("feed").Feed | null = null;
		const dateIndex = await loadDateIndex(feedConfig.feedId);
		const knownHashes = new Map(dateIndex);

		// SSRF protection: validate the feed URL before any fetch.
		// Migration note: replace env reads with settings lookups when Settings Page lands.
		const feedUrl =
			feedConfig.feedType === "webScraping"
				? (feedConfig.config.baseUrl || "").trim()
				: feedConfig.feedType === "api" || feedConfig.feedType === "rest"
					? (
							(feedConfig.config.baseUrl || "") +
							(feedConfig.config.route || "")
						).trim()
					: feedConfig.feedType === "sitemap"
						? (feedConfig as any).sitemap?.url
						: feedConfig.feedType === "calendar"
							? (feedConfig as any).calendar?.url
							: feedConfig.feedType === "graphql"
								? (feedConfig as any).graphql?.endpoint
								: feedConfig.feedType === "serviceConnector"
									? (feedConfig as any).serviceConnector?.connection?.settings
											?.serverUrl
									: null;

		// Build the effective outbound-fetch policy for this feed (used for initial
		// check and for re-checking redirect targets).
		const globalAllowPrivate = process.env.ALLOW_PRIVATE_FETCHES === "true";
		const globalAllowlist = parseAllowlist(
			process.env.OUTBOUND_FETCH_ALLOWLIST,
		);
		const globalPolicyOptions: OutboundFetchPolicyOptions = {
			allowPrivateFetches: globalAllowPrivate,
			allowlist: globalAllowlist,
		};
		const effectivePolicyOptions = mergeFeedPolicyOptions(
			globalPolicyOptions,
			feedConfig as any,
		);

		if (feedUrl) {
			await assertOutboundFetchAllowed(feedUrl, effectivePolicyOptions);
		}

		// Refuse unknown and unimplemented types by name, before doing any work.
		// The sixteen-branch chain below used to fall off its end into a generic
		// "RSS XML could not be generated", which is indistinguishable from a
		// selector that matched nothing — so a typo'd feedType looked like a
		// broken feed rather than a rejected one.
		const sourceDefinition = getFeedSourceDefinition(feedConfig.feedType);
		if (!sourceDefinition) {
			throw new Error(
				`Unknown feed source type "${feedConfig.feedType}": it is not declared in the ` +
					"source-definition registry.",
			);
		}
		if (!sourceDefinition.implemented) {
			throw new Error(
				`Feed source type "${feedConfig.feedType}" is registered but not implemented, ` +
					"so it cannot be executed.",
			);
		}

		// Common: Convert cookie array to string for Axios, or format for Playwright
		const cookieString = (feedConfig.cookies || [])
			.map((c: any) => {
				const val = resolveProtectedValues(c.value, { encryptionKey: encKey });
				return `${c.name}=${val}`;
			})
			.join("; ");

		if (feedConfig.feedType === "feedTransformer") {
			const transformerResult = await runFeedTransformer(feedConfig as any, {
				policyOptions: effectivePolicyOptions,
			});
			lastFeedObject = transformerResult.feed;
			lastBuildResult = {
				xml: transformerResult.feed.rss2(),
				metrics: {
					itemCount: transformerResult.metrics.itemCount,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: transformerResult.metrics.duplicateGuids,
				},
			};
		} else if (feedConfig.feedType === "sitemap") {
			const items = await fetchAndBuildSitemapItems(
				(feedConfig as any).sitemap,
			);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "calendar") {
			const items = await fetchAndBuildCalendarItems(
				(feedConfig as any).calendar,
			);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "graphql") {
			const result = await executeGraphQLFeed({
				endpoint: (feedConfig as any).graphql.endpoint,
				headers: resolveProtectedValues(
					(feedConfig as any).graphql.headers ?? {},
					{ encryptionKey: encKey },
				),
				query: (feedConfig as any).graphql.query,
				variables: (feedConfig as any).graphql.variables,
				operationName: (feedConfig as any).graphql.operationName,
				timeoutMs: (feedConfig as any).graphql.timeoutMs,
			});
			const items = buildGraphQLItems(result.data, (feedConfig as any).graphql);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "webhook") {
			const items = buildWebhookItems(
				await readWebhookEvents(feedConfig.feedId),
				(feedConfig as any).webhookFeed,
			);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "filesystem") {
			const result = await scanFilesystemFeed(
				(feedConfig as any).filesystem,
				process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd(),
				feedConfig.feedId,
			);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items: result.items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: result.items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "serviceConnector") {
			const db = getDb();
			const priorState = loadServiceConnectorState(db, feedConfig.feedId);
			const result = await runServiceConnector(
				(feedConfig as any).serviceConnector,
				encKey,
				priorState,
			);
			if (result.nextState)
				saveServiceConnectorState(
					db,
					feedConfig.feedId,
					result.nextState as any,
				);
			lastFeedObject = buildFeedFromNormalizedItems({
				feedId: feedConfig.feedId,
				feedName: feedConfig.feedName,
				items: result.items,
			});
			lastBuildResult = {
				xml: lastFeedObject.rss2(),
				metrics: {
					itemCount: result.items.length,
					selectorMatches: null,
					dateFallbacks: 0,
					duplicateGuids: 0,
				},
			};
		} else if (feedConfig.feedType === "webScraping") {
			if (feedConfig.flaresolverr?.enabled) {
				// FlareSolverr scraping
				const flaresolverrUrl =
					feedConfig.flaresolverr.serverUrl || "http://localhost:8191";
				const timeout = feedConfig.flaresolverr.timeout || 60000;

				// Routed through the one approved FlareSolverr adapter, which
				// validates the endpoint and the target separately and bounds the
				// whole call. The feed id is logged, not the endpoint: the server
				// URL can carry credentials.
				console.log(`[Feed ${feedConfig.feedId}] Using FlareSolverr`);

				const solved = await solveWithFlareSolverr({
					serverUrl: flaresolverrUrl,
					targetUrl: feedConfig.config.baseUrl,
					maxTimeoutMs: timeout,
					cookies: (feedConfig.cookies ?? []).map((c: any) => ({
						name: c.name,
						value: resolveProtectedValues(c.value, { encryptionKey: encKey }),
					})),
					policyOptions: effectivePolicyOptions,
					budgetMs: resolveFetchPolicy(feedConfig as any).feedRunTimeoutMs,
				});

				httpStatus = solved.status;

				{
					const flareResult = await buildFeedObject(
						solved.html,
						feedConfig,
						dateIndex,
					);
					lastFeedObject = flareResult.feed;
					lastBuildResult = {
						xml: flareResult.feed.rss2(),
						metrics: flareResult.metrics,
					};
				}
			} else if (feedConfig.advanced) {
				// Advanced scraping with Playwright
				const browser = await chromium.launch(
					getChromiumLaunchOptions({
						headless: true,
						timeout: 60000, // 1 minute timeout
					}),
				);
				const userAgent = getRandomUserAgent();
				const context = await browser.newContext({ userAgent });
				await context.addInitScript(() => {
					Object.defineProperty(navigator, "webdriver", {
						get: () => undefined,
					});
				});
				const page = await context.newPage();

				if (feedConfig.headers && Object.keys(feedConfig.headers).length) {
					await page.setExtraHTTPHeaders(
						resolveProtectedValues(feedConfig.headers, {
							encryptionKey: encKey,
						}),
					);
				}

				if (feedConfig.cookies && feedConfig.cookies.length > 0) {
					const domain = new URL(feedConfig.config.baseUrl).hostname;
					// Playwright expects cookies in a specific format
					const playwrightCookies = feedConfig.cookies.map((c) => ({
						name: c.name,
						value: resolveProtectedValues(c.value, { encryptionKey: encKey }),
						domain: domain,
						path: "/", // Common default path
						// Potentially add other fields like expires, httpOnly, secure if available in your cookie object
					}));
					if (playwrightCookies.length)
						await page.context().addCookies(playwrightCookies);
				}

				try {
					await page.goto(feedConfig.config.baseUrl, {
						waitUntil: "networkidle",
						timeout: 10000, // 10 second timeout for networkidle
					});
				} catch (_error) {
					// If networkidle times out, page is likely already loaded
					console.log(
						`[Feed ${feedConfig.feedId}] Networkidle timeout, using current page state`,
					);
				}
				const html = await page.content();
				await browser.close();
				const playwrightResult = await buildFeedObject(
					html,
					feedConfig,
					dateIndex,
				);
				lastFeedObject = playwrightResult.feed;
				lastBuildResult = {
					xml: playwrightResult.feed.rss2(),
					metrics: playwrightResult.metrics,
				};
			} else {
				// Standard web scraping with Axios
				const resolvedHeaders = resolveProtectedValues(
					feedConfig.headers ?? {},
					{ encryptionKey: encKey },
				);
				const response = await fetchWebScrapingHtml({
					feedConfig: feedConfig as any,
					policyOptions: effectivePolicyOptions,
					encryptionKey: encKey,
					headers: resolvedHeaders,
					cookieString,
				});
				httpStatus = response.status;
				const html = response.html;
				const standardResult = await buildFeedObject(
					html,
					feedConfig,
					dateIndex,
				);
				lastFeedObject = standardResult.feed;
				lastBuildResult = {
					xml: standardResult.feed.rss2(),
					metrics: standardResult.metrics,
				};
			}
		} else if (
			feedConfig.feedType === "api" ||
			feedConfig.feedType === "rest"
		) {
			const method = String(feedConfig.config.method || "GET").toUpperCase();
			const url =
				(feedConfig.config.baseUrl || "").trim() +
				(feedConfig.config.route || "").trim();

			const headers: Record<string, string> = resolveProtectedValues(
				{
					Accept: "application/json",
					...(feedConfig.headers || {}),
					...(feedConfig.config.apiSpecificHeaders || {}),
				},
				{ encryptionKey: encKey },
			);

			if (
				cookieString &&
				!headers.Cookie &&
				!headers.cookie &&
				!headers.Authorization
			) {
				headers.Cookie = cookieString;
			}

			const axiosConfig: AxiosRequestConfig = {
				method,
				url,
				headers,
				params: resolveProtectedValues(feedConfig.config.params || {}, {
					encryptionKey: encKey,
				}),
				responseType: "json",
				validateStatus: (s) => s >= 200 && s < 400,
			};

			const body = feedConfig.config.apiSpecificBody || {};
			const hasBody =
				method !== "GET" &&
				method !== "HEAD" &&
				body &&
				typeof body === "object" &&
				Object.keys(body).length > 0;

			if (hasBody) axiosConfig.data = body;

			axiosConfig.timeout = 60000;
			axiosConfig.maxRedirects = 0;

			// The third copy of this redirect loop in the codebase, now replaced
			// by the shared method-aware executor — so this path gets address
			// pinning and one total deadline, neither of which the local loop had.
			const response = await requestWithPolicyRedirects(
				url,
				axiosConfig,
				effectivePolicyOptions,
			);
			httpStatus = response.status;
			const apiData = response.data;
			const apiResult = buildFeedObjectFromApiData(
				apiData,
				feedConfig,
				dateIndex,
			);
			lastFeedObject = apiResult.feed;
			lastBuildResult = {
				xml: apiResult.feed.rss2(),
				metrics: apiResult.metrics,
			};
		}

		if (lastFeedObject) {
			// 1. Write all three formats
			const outputUrls = await writeAllFeedFormats(
				feedConfig.feedId,
				lastFeedObject,
			);

			// 2. Store format-agnostic snapshot
			const snapshots = extractFeedItemSnapshots(lastFeedObject);
			await storeFeedHistory(
				feedConfig.feedId,
				JSON.stringify(snapshots),
				"items_json",
			);

			// 3. Update item hash index
			try {
				await saveDateIndex(feedConfig.feedId, dateIndex);
			} catch (indexErr) {
				console.error(
					"[Feed %s] Failed to persist date index:",
					feedConfig.feedId,
					indexErr,
				);
			}

			// 4. Webhook delivery — only if configured
			const webhookConfig = feedConfig.webhook
				? resolveProtectedValues(feedConfig.webhook, { encryptionKey: encKey })
				: undefined;
			if (webhookConfig?.enabled && webhookConfig.url) {
				try {
					const {
						sendWebhook,
						createWebhookPayload,
						createJsonWebhookPayload,
					} = await import("../utilities/webhook.utility");

					const newItemHashes = new Set(
						[...dateIndex.keys()].filter((k) => !knownHashes.has(k)),
					);

					const shouldDeliver =
						!webhookConfig.newItemsOnly || newItemHashes.size > 0;

					if (shouldDeliver) {
						const outputs = serializeAllFeedFormats(lastFeedObject);
						const payload =
							webhookConfig.format === "json"
								? createJsonWebhookPayload(
										feedConfig,
										outputs.rss2,
										"automatic",
									)
								: createWebhookPayload(feedConfig, outputs.rss2, "automatic");

						const success = await sendWebhook(
							{
								...webhookConfig,
								url: webhookConfig.url,
								format: webhookConfig.format ?? "xml",
								newItemsOnly: webhookConfig.newItemsOnly ?? true,
							},
							payload,
						);
						if (success) {
							lastWebhookStatus = "success";
							console.log(
								`Webhook sent for feed ${feedConfig.feedId} (${newItemHashes.size} new items)`,
							);
						} else {
							lastWebhookStatus = "failed";
							lastWebhookError = "Webhook send returned false";
							console.warn(`Webhook failed for feed ${feedConfig.feedId}`);
						}
					} else {
						lastWebhookStatus = "skipped";
					}
				} catch (webhookError) {
					lastWebhookStatus = "failed";
					lastWebhookError = asError(webhookError).message;
					console.error(
						"[Feed %s] Webhook error:",
						feedConfig.feedId,
						webhookError,
					);
				}
			} else {
				lastWebhookStatus = "skipped";
			}

			self.postMessage({
				status: "done",
				feedId: feedConfig.feedId,
				metrics: {
					startedAt,
					durationMs: Date.now() - startedAt,
					httpStatus,
					timedOut,
					itemCount: lastBuildResult?.metrics.itemCount ?? null,
					selectorMatches: lastBuildResult?.metrics.selectorMatches ?? null,
					dateFallbacks: lastBuildResult?.metrics.dateFallbacks ?? 0,
					duplicateGuids: lastBuildResult?.metrics.duplicateGuids ?? 0,
					webhookStatus: lastWebhookStatus,
					webhookError: lastWebhookError,
					errorMessage: null,
				},
			});
		} else {
			self.postMessage({
				status: "error",
				feedId: feedConfig.feedId,
				error: "RSS XML could not be generated.",
			});
		}
	} catch (error) {
		const caughtError = asError(error);
		if (
			("code" in caughtError && caughtError.code === "ECONNABORTED") ||
			caughtError.message.toLowerCase().includes("timeout") ||
			caughtError.message.toLowerCase().includes("timed out")
		) {
			timedOut = true;
		}

		console.error(
			"Error fetching/processing data for feedId %s:",
			feedConfig.feedId,
			caughtError.message,
			caughtError.stack,
		);
		self.postMessage({
			status: "error",
			feedId: feedConfig.feedId,
			metrics: {
				startedAt,
				durationMs: Date.now() - startedAt,
				httpStatus,
				timedOut,
				itemCount: null,
				selectorMatches: null,
				dateFallbacks: 0,
				duplicateGuids: 0,
				webhookStatus: null,
				webhookError: null,
				errorMessage: caughtError.message,
			},
		});
	}
}

self.onmessage = (message) => {
	if (message.data.command === "start") {
		console.log(
			`Worker received start command for feedId: ${message.data.config.feedId}`,
		);
		fetchDataAndUpdateFeed(message.data.config);
	}
};

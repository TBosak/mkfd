// TDD slice: p3-safe-user-patterns
//
// This suite drives the public validation and runtime filtering boundaries for
// feed-transformer and sitemap regex rules. Sitemap HTTP calls use the same
// module-level axios seam as the existing outbound tests; no request leaves the
// test process. Boundary fixtures are sized by encoded UTF-8 bytes.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import type { FeedConfig } from "../models/feed-config.model";
import type {
	BasicFilterRule,
	BasicItemTransformConfig,
} from "../models/feed-transformer.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type {
	SitemapFeedConfig,
	SitemapFilterRule,
} from "../models/sitemap.model";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import {
	type ValidationResult,
	validateFeedConfig,
} from "../utilities/feed-config-validator.utility";
import { filterFeedItems } from "../utilities/feed-item-filter.utility";
import { fetchAndBuildSitemapItems } from "../utilities/sitemap.utility";

const PATTERN_MAX_BYTES = 512;
const CANDIDATE_MAX_BYTES = 64 * 1024;
const REGEX_RULE_MAX = 64;

const PATTERN_SENTINEL = "p3-pattern-secret-7b3e";
const CANDIDATE_SENTINEL = "p3-candidate-secret-8c4f";
const OVER_BUDGET_SENTINEL = "p3-budget-secret-9d5a";

const originalAxiosGet = axios.get;

afterEach(() => {
	axios.get = originalAxiosGet;
});

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function stringOfBytes(
	prefix: string,
	suffix: string,
	targetBytes: number,
	fill = "x",
): string {
	const fixedBytes = utf8Bytes(prefix) + utf8Bytes(suffix);
	if (fixedBytes > targetBytes) {
		throw new Error(
			`Test fixture exceeds target byte length (${fixedBytes} > ${targetBytes})`,
		);
	}
	const fillBytes = utf8Bytes(fill);
	if (fillBytes === 0) throw new Error("Test fixture fill must not be empty");
	const remaining = targetBytes - fixedBytes;
	const repeated = fill.repeat(Math.floor(remaining / fillBytes));
	const remainder = remaining - utf8Bytes(repeated);
	return `${prefix}${repeated}${"a".repeat(remainder)}${suffix}`;
}

function feedItem(
	overrides: Partial<NormalizedFeedItem> = {},
): NormalizedFeedItem {
	return { title: "ordinary item", ...overrides };
}

function feedTransformerRaw(
	filters: BasicItemTransformConfig["filters"],
): Record<string, unknown> {
	return {
		feedId: "safe-pattern-feed",
		feedName: "Safe Pattern Feed",
		feedType: "feedTransformer",
		refreshTime: 5,
		feedTransformer: {
			sources: [{ url: "https://example.com/feed.xml", format: "rss" }],
			mergeStrategy: "preserveOrder",
			dedupeAcrossSources: true,
			items: { filters },
		},
	};
}

function sitemapRaw(
	filters: SitemapFeedConfig["filters"],
): Record<string, unknown> {
	return {
		feedId: "safe-pattern-sitemap",
		feedName: "Safe Pattern Sitemap",
		feedType: "sitemap",
		refreshTime: 5,
		sitemap: {
			inputMode: "exact",
			url: "http://example.com/sitemap.xml",
			mode: "urlList",
			maxItems: 100,
			maxUrlsToScan: 100,
			sortOrder: "sitemapOrder",
			dateStrategy: "bestAvailable",
			titleStrategy: "path",
			descriptionStrategy: "none",
			filters,
		},
	};
}

function sitemapRuntimeConfig(
	filters: SitemapFeedConfig["filters"],
): SitemapFeedConfig {
	return {
		inputMode: "exact",
		url: "http://example.com/sitemap.xml",
		mode: "urlList",
		maxItems: 100,
		maxUrlsToScan: 100,
		sortOrder: "sitemapOrder",
		dateStrategy: "bestAvailable",
		titleStrategy: "path",
		descriptionStrategy: "none",
		filters,
	};
}

function normalizedFeedTransformer(
	filters: BasicItemTransformConfig["filters"],
): FeedConfig {
	return normalizeLoadedFeedConfig(feedTransformerRaw(filters));
}

function normalizedSitemap(filters: SitemapFeedConfig["filters"]): FeedConfig {
	return normalizeLoadedFeedConfig(sitemapRaw(filters));
}

function validationForFeedTransformer(
	filters: BasicItemTransformConfig["filters"],
): ValidationResult {
	return validateFeedConfig(normalizedFeedTransformer(filters));
}

function validationForSitemap(
	filters: SitemapFeedConfig["filters"],
): ValidationResult {
	return validateFeedConfig(normalizedSitemap(filters));
}

function expectPatternContractError(
	error: unknown,
	...sentinels: string[]
): void {
	expect(error, "the pattern contract must reject the input").toBeDefined();
	const message = error instanceof Error ? error.message : String(error);
	expect(message).toMatch(/pattern|regex|regular expression/i);
	for (const sentinel of sentinels) expect(message).not.toContain(sentinel);
}

function expectValidationPatternError(
	result: ValidationResult,
	path: RegExp,
	...sentinels: string[]
): void {
	const issue = result.errors.find((error) => path.test(error.path));
	expect(
		issue,
		"validation must report the filter at its source path",
	).toBeDefined();
	if (!issue) return;
	expect(issue.message).toMatch(
		/pattern|regex|regular expression|limit|budget|unsupported/i,
	);
	for (const sentinel of sentinels)
		expect(issue.message).not.toContain(sentinel);
}

type NativeRegexObservation<T> = {
	value?: T;
	error?: unknown;
	patterns: string[];
};

async function observeNativeRegex<T>(
	action: () => T | Promise<T>,
): Promise<NativeRegexObservation<T>> {
	const originalRegExp = globalThis.RegExp;
	const patterns: string[] = [];
	const observedRegExp = new Proxy(originalRegExp, {
		construct(target, args, newTarget) {
			patterns.push(String(args[0] ?? ""));
			return Reflect.construct(target, args, newTarget);
		},
	});
	globalThis.RegExp = observedRegExp as typeof RegExp;
	try {
		return { value: await action(), patterns };
	} catch (error) {
		return { error, patterns };
	} finally {
		globalThis.RegExp = originalRegExp;
	}
}

function mockSitemapXml(xml: string): string[] {
	const calls: string[] = [];
	axios.get = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: xml };
	}) as typeof axios.get;
	return calls;
}

function sitemapXml(
	entries: Array<{
		loc: string;
		lastmod?: string;
		changefreq?: string;
		priority?: string;
	}>,
): string {
	return [
		`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		...entries.map((entry) =>
			[
				"<url>",
				`<loc>${entry.loc}</loc>`,
				entry.lastmod === undefined
					? ""
					: `<lastmod>${entry.lastmod}</lastmod>`,
				entry.changefreq === undefined
					? ""
					: `<changefreq>${entry.changefreq}</changefreq>`,
				entry.priority === undefined
					? ""
					: `<priority>${entry.priority}</priority>`,
				"</url>",
			].join(""),
		),
		"</urlset>",
	].join("");
}

const dangerousPatterns = [
	{ name: "malformed syntax", source: `${PATTERN_SENTINEL}[` },
	{ name: "nested quantifier", source: `${PATTERN_SENTINEL}(a+)+$` },
	{
		name: "ambiguous quantified alternation",
		source: `${PATTERN_SENTINEL}(a|aa)+$`,
	},
	{ name: "numeric backreference", source: `${PATTERN_SENTINEL}(a)\\1` },
	{
		name: "named backreference",
		source: `${PATTERN_SENTINEL}(?<capture>a)\\k<capture>`,
	},
	{ name: "positive lookahead", source: `${PATTERN_SENTINEL}a(?=b)` },
	{ name: "negative lookahead", source: `${PATTERN_SENTINEL}a(?!b)` },
	{ name: "positive lookbehind", source: `${PATTERN_SENTINEL}(?<=a)b` },
	{ name: "negative lookbehind", source: `${PATTERN_SENTINEL}(?<!a)b` },
];

const safePatternExamples = [
	{
		name: "anchors and alternation",
		source: `^(News|Notices)$`,
		candidate: "News",
	},
	{
		name: "escaped punctuation",
		source: String.raw`^/news/\d+\.html$`,
		candidate: "/news/42.html",
	},
	{
		name: "character class",
		source: `^[A-Z][a-z]+$`,
		candidate: "Notice",
	},
	{
		name: "capturing group",
		source: String.raw`^(item)-(\d+)$`,
		candidate: "item-42",
	},
	{
		name: "non-capturing group",
		source: String.raw`^(?:news|notice)-\d+$`,
		candidate: "news-7",
	},
	{
		name: "bounded quantifier",
		source: `^a{2,4}$`,
		candidate: "aaa",
	},
	{ name: "unbounded quantifier", source: `^a+$`, candidate: "aaaa" },
];

function regexRules(
	count: number,
	field: BasicFilterRule["field"] = "title",
): BasicFilterRule[] {
	return Array.from({ length: count }, (_, index) => ({
		field,
		type: "regex" as const,
		value: `^never-match-${index}$`,
		caseSensitive: true,
	}));
}

describe("p3 safe user patterns — validation contract", () => {
	for (const source of [
		{
			name: "feed-transformer",
			validate: validationForFeedTransformer,
			path: /^feedTransformer\.items\.filters\.include\.0(?:\.value)?$/,
			overBudgetPath:
				/^feedTransformer\.items\.filters\.exclude\.32(?:\.value)?$/,
		},
		{
			name: "sitemap",
			validate: validationForSitemap,
			path: /^sitemap\.filters\.include\.0(?:\.value)?$/,
			overBudgetPath: /^sitemap\.filters\.exclude\.32(?:\.value)?$/,
		},
	]) {
		const validationField = source.name === "sitemap" ? "loc" : "title";
		test(`${source.name} accepts documented and RE2-compatible syntax`, () => {
			for (const example of safePatternExamples) {
				const result = source.validate({
					include: [
						{ field: validationField, type: "regex", value: example.source },
					],
				});
				expect(result.errors, example.name).toHaveLength(0);
			}
			const documented = source.validate({
				include: [
					{
						field: validationField,
						type: "regex",
						value: "/news|/notices|/agendas",
					},
				],
				exclude: [
					{
						field: validationField,
						type: "regex",
						value: "/tag/|/category/|/author/",
					},
				],
			});
			expect(documented.errors).toHaveLength(0);
			expect(
				source.validate({
					include: [{ field: validationField, type: "regex", value: "" }],
				}).errors,
			).toHaveLength(0);
		});

		test(`${source.name} rejects malformed, catastrophic, backreference, and lookaround syntax`, () => {
			for (const dangerous of dangerousPatterns) {
				const result = source.validate({
					include: [
						{ field: validationField, type: "regex", value: dangerous.source },
					],
				});
				expectValidationPatternError(result, source.path, PATTERN_SENTINEL);
			}
		});

		test(`${source.name} enforces the 512-byte UTF-8 pattern boundary`, () => {
			const exact = "é".repeat(256);
			expect(utf8Bytes(exact)).toBe(PATTERN_MAX_BYTES);
			expect(exact.length).toBeLessThan(PATTERN_MAX_BYTES);
			expect(
				source.validate({
					include: [{ field: validationField, type: "regex", value: exact }],
				}).errors,
			).toHaveLength(0);

			const over = stringOfBytes(
				"",
				`${PATTERN_SENTINEL}`,
				PATTERN_MAX_BYTES + 1,
				"é",
			);
			expect(utf8Bytes(over)).toBe(PATTERN_MAX_BYTES + 1);
			expectValidationPatternError(
				source.validate({
					include: [{ field: validationField, type: "regex", value: over }],
				}),
				source.path,
				PATTERN_SENTINEL,
			);
		});

		test(`${source.name} counts only regex rules toward the 64-rule budget`, () => {
			const exactRules = Array.from({ length: REGEX_RULE_MAX }, (_, index) => ({
				field: validationField,
				type: "regex" as const,
				value: `^never-match-${index}$`,
			}));
			const exact = source.validate({
				include: exactRules.slice(0, 32),
				exclude: [
					...exactRules.slice(32),
					{ field: validationField, type: "contains", value: "keyword" },
				],
			});
			expect(exact.errors).toHaveLength(0);

			const overRules = {
				include: exactRules.slice(0, 32),
				exclude: [
					...exactRules.slice(32),
					{
						field: validationField,
						type: "regex",
						value: `${OVER_BUDGET_SENTINEL}.*`,
					},
				],
			};
			const over = source.validate(overRules);
			expectValidationPatternError(
				over,
				source.overBudgetPath,
				OVER_BUDGET_SENTINEL,
			);
		});
	}
});

describe("p3 safe user patterns — feed-transformer runtime", () => {
	test("supports scalar fields, categories, case sensitivity, empty match-all, and exclude precedence", () => {
		for (const example of safePatternExamples) {
			const result = filterFeedItems({
				items: [feedItem({ title: example.candidate })],
				filters: {
					include: [{ field: "title", type: "regex", value: example.source }],
				},
			});
			expect(result.items, example.name).toHaveLength(1);
		}

		const items = [
			feedItem({ title: "field-title" }),
			feedItem({ link: "https://example.com/field-link" }),
			feedItem({ description: "field-description" }),
			feedItem({ content: "field-content" }),
			feedItem({ author: "field-author" }),
			feedItem({ categories: ["field-category"] }),
		];
		const fields: BasicFilterRule[] = [
			{
				field: "title",
				type: "regex",
				value: "^field-title$",
				caseSensitive: true,
			},
			{
				field: "link",
				type: "regex",
				value: "^https://example\\.com/field-link$",
				caseSensitive: true,
			},
			{
				field: "description",
				type: "regex",
				value: "^field-description$",
				caseSensitive: true,
			},
			{
				field: "content",
				type: "regex",
				value: "^field-content$",
				caseSensitive: true,
			},
			{
				field: "author",
				type: "regex",
				value: "^field-author$",
				caseSensitive: true,
			},
			{
				field: "categories",
				type: "regex",
				value: "^field-category$",
				caseSensitive: true,
			},
		];
		const result = filterFeedItems({ items, filters: { include: fields } });
		expect(result.items).toHaveLength(6);

		const insensitive = filterFeedItems({
			items: [feedItem({ title: "News" })],
			filters: {
				include: [
					{
						field: "title",
						type: "regex",
						value: "^news$",
						caseSensitive: false,
					},
				],
			},
		});
		const sensitive = filterFeedItems({
			items: [feedItem({ title: "News" })],
			filters: {
				include: [
					{
						field: "title",
						type: "regex",
						value: "^news$",
						caseSensitive: true,
					},
				],
			},
		});
		expect(insensitive.items).toHaveLength(1);
		expect(sensitive.items).toHaveLength(0);

		const empty = filterFeedItems({
			items,
			filters: { include: [{ field: "title", type: "regex", value: "" }] },
		});
		expect(empty.items).toHaveLength(items.length);

		const precedence = filterFeedItems({
			items: [
				feedItem({ title: "Tech Sponsored" }),
				feedItem({ title: "Tech News" }),
				feedItem({ title: "Sports" }),
			],
			filters: {
				include: [{ field: "title", type: "regex", value: "^Tech" }],
				exclude: [{ field: "title", type: "regex", value: "Sponsored" }],
			},
		});
		expect(precedence.items.map((item) => item.title)).toEqual(["Tech News"]);
	});

	test("retains all non-regex filter semantics", () => {
		const cases: Array<{
			type: BasicFilterRule["type"];
			value: string;
			expected: boolean;
		}> = [
			{ type: "contains", value: "pha", expected: true },
			{ type: "notContains", value: "zzz", expected: true },
			{ type: "equals", value: "Alpha", expected: true },
			{ type: "startsWith", value: "Al", expected: true },
			{ type: "endsWith", value: "ha", expected: true },
		];
		for (const filter of cases) {
			const result = filterFeedItems({
				items: [feedItem({ title: "Alpha" })],
				filters: {
					include: [{ field: "title", type: filter.type, value: filter.value }],
				},
			});
			expect(result.items).toHaveLength(filter.expected ? 1 : 0);
		}
		const sensitive = filterFeedItems({
			items: [feedItem({ title: "Alpha" })],
			filters: {
				include: [
					{
						field: "title",
						type: "contains",
						value: "alpha",
						caseSensitive: true,
					},
				],
			},
		});
		expect(sensitive.items).toHaveLength(0);
	});

	test("accepts an exactly 512-byte UTF-8 regex and rejects +1 at runtime", async () => {
		const exactPattern = "é".repeat(256);
		const exact = filterFeedItems({
			items: [feedItem({ title: exactPattern })],
			filters: {
				include: [{ field: "title", type: "regex", value: exactPattern }],
			},
		});
		expect(exact.items).toHaveLength(1);

		const overPattern = stringOfBytes(
			"",
			PATTERN_SENTINEL,
			PATTERN_MAX_BYTES + 1,
			"é",
		);
		const observed = await observeNativeRegex(() =>
			filterFeedItems({
				items: [feedItem({ title: "candidate" })],
				filters: {
					include: [{ field: "title", type: "regex", value: overPattern }],
				},
			}),
		);
		expectPatternContractError(observed.error, PATTERN_SENTINEL);
		expect(observed.patterns).not.toContain(overPattern);
	});

	test("accepts an exactly 64 KiB UTF-8 candidate and rejects +1 before native evaluation", async () => {
		const exactCandidate = "é".repeat(32_768);
		expect(utf8Bytes(exactCandidate)).toBe(CANDIDATE_MAX_BYTES);
		expect(exactCandidate.length).toBeLessThan(CANDIDATE_MAX_BYTES);
		const exact = filterFeedItems({
			items: [feedItem({ title: exactCandidate })],
			filters: { include: [{ field: "title", type: "regex", value: "^é+$" }] },
		});
		expect(exact.items).toHaveLength(1);

		const overCandidate = stringOfBytes(
			"",
			CANDIDATE_SENTINEL,
			CANDIDATE_MAX_BYTES + 1,
			"é",
		);
		expect(utf8Bytes(overCandidate)).toBe(CANDIDATE_MAX_BYTES + 1);
		const observed = await observeNativeRegex(() =>
			filterFeedItems({
				items: [feedItem({ title: overCandidate })],
				filters: {
					include: [{ field: "title", type: "regex", value: "^é+$" }],
				},
			}),
		);
		expectPatternContractError(observed.error, CANDIDATE_SENTINEL);
		expect(observed.patterns).not.toContain("^é+$");
	});

	for (const dangerous of dangerousPatterns) {
		test(`rejects ${dangerous.name} without constructing a native RegExp`, async () => {
			const observed = await observeNativeRegex(() =>
				filterFeedItems({
					items: [feedItem({ title: CANDIDATE_SENTINEL })],
					filters: {
						include: [
							{ field: "title", type: "regex", value: dangerous.source },
						],
					},
				}),
			);
			expectPatternContractError(
				observed.error,
				PATTERN_SENTINEL,
				CANDIDATE_SENTINEL,
			);
			expect(observed.patterns).not.toContain(dangerous.source);
		});
	}

	test("rejects a 65-regex legacy filter collection at runtime while allowing 64 plus a keyword", async () => {
		const exactRules = {
			include: regexRules(32),
			exclude: [
				...regexRules(32, "link"),
				{ field: "title", type: "contains" as const, value: "never" },
			],
		};
		const exact = filterFeedItems({
			items: [feedItem({ title: "ordinary" })],
			filters: exactRules,
		});
		expect(exact.items).toHaveLength(0);

		const overRules = {
			include: regexRules(32),
			exclude: [
				...regexRules(32, "link"),
				{
					field: "title",
					type: "regex" as const,
					value: `${OVER_BUDGET_SENTINEL}.*`,
				},
			],
		};
		const observed = await observeNativeRegex(() =>
			filterFeedItems({
				items: [feedItem({ title: CANDIDATE_SENTINEL })],
				filters: overRules,
			}),
		);
		expectPatternContractError(
			observed.error,
			OVER_BUDGET_SENTINEL,
			CANDIDATE_SENTINEL,
		);
	});

	test("evaluates one accepted regex rule across multiple feed candidates", () => {
		const pattern = "^keep$";
		let compileCount = 0;
		const onPatternCompiled = (...args: unknown[]) => {
			if (args.length !== 0) {
				throw new Error(
					"pattern compile instrumentation must receive no arguments",
				);
			}
			compileCount += 1;
		};
		const instrumentedFilterFeedItems = filterFeedItems as unknown as (
			input: Parameters<typeof filterFeedItems>[0],
			options?: { onPatternCompiled?: (...args: unknown[]) => void },
		) => ReturnType<typeof filterFeedItems>;
		const result = instrumentedFilterFeedItems(
			{
				items: [
					feedItem({ title: "keep" }),
					feedItem({ title: "drop" }),
					feedItem({ title: "keep" }),
				],
				filters: {
					include: [{ field: "title", type: "regex", value: pattern }],
				},
			},
			{ onPatternCompiled },
		);
		expect(result.items).toHaveLength(2);
		expect(compileCount).toBe(1);
	});
});

describe("p3 safe user patterns — sitemap runtime", () => {
	test("executes supported RE2-compatible syntax and empty match-all on sitemap fields", async () => {
		for (const example of safePatternExamples) {
			mockSitemapXml(
				sitemapXml([
					{ loc: "https://example.com/safe", lastmod: example.candidate },
				]),
			);
			const config = sitemapRuntimeConfig({
				include: [{ field: "lastmod", type: "regex", value: example.source }],
			});
			expect(
				await fetchAndBuildSitemapItems(config),
				example.name,
			).toHaveLength(1);
		}
		mockSitemapXml(sitemapXml([{ loc: "https://example.com/empty" }]));
		expect(
			await fetchAndBuildSitemapItems(
				sitemapRuntimeConfig({
					include: [{ field: "loc", type: "regex", value: "" }],
				}),
			),
		).toHaveLength(1);
	});

	test("supports documented include/exclude regex examples and preserves exclude precedence", async () => {
		const xml = sitemapXml([
			{ loc: "https://example.com/news/one" },
			{ loc: "https://example.com/tag/news" },
			{ loc: "https://example.com/notices/two" },
			{ loc: "https://example.com/category/notices" },
			{ loc: "https://example.com/agendas/three" },
			{ loc: "https://example.com/author/editor" },
		]);
		mockSitemapXml(xml);
		const config = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "regex", value: "/news|/notices|/agendas" },
			],
			exclude: [
				{ field: "loc", type: "regex", value: "/tag/|/category/|/author/" },
			],
		});
		const items = await fetchAndBuildSitemapItems(config);
		expect(items.map((item) => item.link)).toEqual([
			"https://example.com/news/one",
			"https://example.com/notices/two",
			"https://example.com/agendas/three",
		]);
	});

	test("matches every sitemap field shape, including numeric priority stringification", async () => {
		const xml = sitemapXml([
			{
				loc: "https://example.com/loc-match",
				lastmod: "2020-01-01",
				changefreq: "never",
				priority: "0.1",
			},
			{
				loc: "https://example.com/other",
				lastmod: "2026-05-20",
				changefreq: "never",
				priority: "0.2",
			},
			{
				loc: "https://example.com/other-2",
				lastmod: "2020-01-01",
				changefreq: "daily",
				priority: "0.3",
			},
			{
				loc: "https://example.com/other-3",
				lastmod: "2020-01-01",
				changefreq: "never",
				priority: "0.7",
			},
		]);
		mockSitemapXml(xml);
		const config = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "regex", value: "loc-match" },
				{ field: "lastmod", type: "regex", value: "^2026-05-20$" },
				{ field: "changefreq", type: "regex", value: "^daily$" },
				{ field: "priority", type: "regex", value: "^0\\.7$" },
			],
		});
		const items = await fetchAndBuildSitemapItems(config);
		expect(items.map((item) => item.link)).toEqual([
			"https://example.com/loc-match",
			"https://example.com/other",
			"https://example.com/other-2",
			"https://example.com/other-3",
		]);
	});

	test("retains sitemap keyword matching and case sensitivity", async () => {
		mockSitemapXml(
			sitemapXml([
				{ loc: "https://example.com/News" },
				{ loc: "https://example.com/other" },
			]),
		);
		const insensitive = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "keyword", value: "/news", caseSensitive: false },
			],
		});
		expect(
			(await fetchAndBuildSitemapItems(insensitive)).map((item) => item.link),
		).toEqual(["https://example.com/News"]);

		mockSitemapXml(sitemapXml([{ loc: "https://example.com/News" }]));
		const sensitive = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "keyword", value: "/news", caseSensitive: true },
			],
		});
		expect(await fetchAndBuildSitemapItems(sensitive)).toHaveLength(0);

		mockSitemapXml(sitemapXml([{ loc: "https://example.com/News" }]));
		const regexInsensitive = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "regex", value: "/news", caseSensitive: false },
			],
		});
		expect(await fetchAndBuildSitemapItems(regexInsensitive)).toHaveLength(1);

		mockSitemapXml(sitemapXml([{ loc: "https://example.com/News" }]));
		const regexSensitive = sitemapRuntimeConfig({
			include: [
				{ field: "loc", type: "regex", value: "/news", caseSensitive: true },
			],
		});
		expect(await fetchAndBuildSitemapItems(regexSensitive)).toHaveLength(0);
	});

	test("accepts an exactly 512-byte UTF-8 regex and rejects +1 at runtime", async () => {
		const exactPattern = "é".repeat(256);
		mockSitemapXml(
			sitemapXml([{ loc: `https://example.com/${exactPattern}` }]),
		);
		const exactConfig = sitemapRuntimeConfig({
			include: [{ field: "loc", type: "regex", value: exactPattern }],
		});
		expect(await fetchAndBuildSitemapItems(exactConfig)).toHaveLength(1);

		const overPattern = stringOfBytes(
			"",
			PATTERN_SENTINEL,
			PATTERN_MAX_BYTES + 1,
			"é",
		);
		mockSitemapXml(sitemapXml([{ loc: "https://example.com/ordinary" }]));
		const observed = await observeNativeRegex(() =>
			fetchAndBuildSitemapItems(
				sitemapRuntimeConfig({
					include: [{ field: "loc", type: "regex", value: overPattern }],
				}),
			),
		);
		expectPatternContractError(observed.error, PATTERN_SENTINEL);
		expect(observed.patterns).not.toContain(overPattern);
	});

	test("accepts an exactly 64 KiB UTF-8 candidate and rejects +1 before native evaluation", async () => {
		const exactCandidate = "é".repeat(32_768);
		expect(utf8Bytes(exactCandidate)).toBe(CANDIDATE_MAX_BYTES);
		mockSitemapXml(
			sitemapXml([
				{ loc: "https://example.com/exact", lastmod: exactCandidate },
			]),
		);
		const exactConfig = sitemapRuntimeConfig({
			include: [{ field: "lastmod", type: "regex", value: "^é+$" }],
		});
		expect(await fetchAndBuildSitemapItems(exactConfig)).toHaveLength(1);

		const overCandidate = stringOfBytes(
			"",
			CANDIDATE_SENTINEL,
			CANDIDATE_MAX_BYTES + 1,
			"é",
		);
		expect(utf8Bytes(overCandidate)).toBe(CANDIDATE_MAX_BYTES + 1);
		mockSitemapXml(
			sitemapXml([{ loc: "https://example.com/over", lastmod: overCandidate }]),
		);
		const observed = await observeNativeRegex(() =>
			fetchAndBuildSitemapItems(
				sitemapRuntimeConfig({
					include: [{ field: "lastmod", type: "regex", value: "^é+$" }],
				}),
			),
		);
		expectPatternContractError(observed.error, CANDIDATE_SENTINEL);
		expect(observed.patterns).not.toContain("^é+$");
	});

	for (const dangerous of dangerousPatterns) {
		test(`rejects ${dangerous.name} without constructing a native RegExp`, async () => {
			mockSitemapXml(
				sitemapXml([{ loc: `https://example.com/${CANDIDATE_SENTINEL}` }]),
			);
			const observed = await observeNativeRegex(() =>
				fetchAndBuildSitemapItems(
					sitemapRuntimeConfig({
						include: [{ field: "loc", type: "regex", value: dangerous.source }],
					}),
				),
			);
			expectPatternContractError(
				observed.error,
				PATTERN_SENTINEL,
				CANDIDATE_SENTINEL,
			);
			expect(observed.patterns).not.toContain(dangerous.source);
		});
	}

	test("rejects a 65-regex legacy filter collection at runtime while allowing 64 plus a keyword", async () => {
		const exactRules: SitemapFeedConfig["filters"] = {
			include: regexRules(32, "loc") as SitemapFilterRule[],
			exclude: [
				...(regexRules(32, "lastmod") as SitemapFilterRule[]),
				{ field: "loc", type: "keyword", value: "never" },
			],
		};
		mockSitemapXml(
			sitemapXml([
				{ loc: "https://example.com/ordinary", lastmod: "2020-01-01" },
			]),
		);
		const exact = await fetchAndBuildSitemapItems(
			sitemapRuntimeConfig(exactRules),
		);
		expect(exact).toHaveLength(0);

		const overRules: SitemapFeedConfig["filters"] = {
			include: regexRules(32, "loc") as SitemapFilterRule[],
			exclude: [
				...(regexRules(32, "lastmod") as SitemapFilterRule[]),
				{ field: "loc", type: "regex", value: `${OVER_BUDGET_SENTINEL}.*` },
			],
		};
		mockSitemapXml(
			sitemapXml([{ loc: `https://example.com/${CANDIDATE_SENTINEL}` }]),
		);
		const observed = await observeNativeRegex(() =>
			fetchAndBuildSitemapItems(sitemapRuntimeConfig(overRules)),
		);
		expectPatternContractError(
			observed.error,
			OVER_BUDGET_SENTINEL,
			CANDIDATE_SENTINEL,
		);
	});

	test("evaluates one accepted regex rule across multiple sitemap candidates", async () => {
		const pattern = "example\\.com/(keep|other)";
		let compileCount = 0;
		const onPatternCompiled = (...args: unknown[]) => {
			if (args.length !== 0) {
				throw new Error(
					"pattern compile instrumentation must receive no arguments",
				);
			}
			compileCount += 1;
		};
		const instrumentedFetchAndBuildSitemapItems =
			fetchAndBuildSitemapItems as unknown as (
				config: Parameters<typeof fetchAndBuildSitemapItems>[0],
				options?: { onPatternCompiled?: (...args: unknown[]) => void },
			) => ReturnType<typeof fetchAndBuildSitemapItems>;
		mockSitemapXml(
			sitemapXml([
				{ loc: "https://example.com/keep" },
				{ loc: "https://example.com/other" },
				{ loc: "https://example.com/drop" },
			]),
		);
		const result = await instrumentedFetchAndBuildSitemapItems(
			sitemapRuntimeConfig({
				include: [{ field: "loc", type: "regex", value: pattern }],
			}),
			{ onPatternCompiled },
		);
		expect(result).toHaveLength(2);
		expect(compileCount).toBe(1);
	});
});

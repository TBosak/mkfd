import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

// Extracted from rss-builder.utility.ts to break the
// data-handler.utility <-> rss-builder.utility circular import, which fallow
// flags as an initialization and tree-shaking risk. data-handler needed only
// looksLikeUrl and discoverUrl from rss-builder; both are self-contained URL
// helpers with no dependency back on either module, so they live here and both
// modules import them one-directionally. rss-builder re-exports them so its
// existing public surface is unchanged.
export function looksLikeUrl(str: string): boolean {
	if (!str) return false;
	return /^https?:\/\//i.test(str) || str.startsWith("//");
}

export function discoverUrl($: CheerioAPI, target: Cheerio<AnyNode>): string {
	if (!target.length) return "";

	let urlToTest: string | undefined;

	// 1. Direct attributes (most reliable for explicit links/media)
	urlToTest = target.attr("href") || target.attr("src");
	if (urlToTest && looksLikeUrl(urlToTest))
		return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

	urlToTest = target.attr("data-src");
	if (urlToTest && looksLikeUrl(urlToTest))
		return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

	urlToTest = target.attr("srcset");
	if (urlToTest && looksLikeUrl(urlToTest.split(/[,\s]+/)[0]))
		return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

	// 2. Schema.org / LD+JSON
	const ldScript = target
		.find('script[type="application/ld+json"]')
		.first()
		.html();
	if (ldScript) {
		try {
			const data = JSON.parse(ldScript);
			urlToTest =
				data?.contentUrl ||
				data?.thumbnailUrl ||
				(Array.isArray(data?.image)
					? data.image[0]?.url || data.image[0]
					: data?.image?.url || data?.image);
			if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest))
				return decodeURIComponent(urlToTest.trim());
		} catch {
			/* ignore bad JSON */
		}
	}

	// 3. OpenGraph meta tags (usually in <head>, but let's check if target is <html> or <body>)
	let searchContext: Cheerio<AnyNode> = target;
	if (target.is("html") || target.is("body")) {
		searchContext = $.root(); // search globally using root
	}
	urlToTest =
		searchContext.find('meta[property="og:image"]').attr("content") ||
		searchContext.find('meta[property="og:video"]').attr("content") ||
		searchContext.find('meta[property="og:audio"]').attr("content");
	if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest))
		return decodeURIComponent(urlToTest.trim());

	// 4. Inline style background-image
	const inlineStyle = target.attr("style");
	if (inlineStyle) {
		const styleMatch = inlineStyle.match(
			/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i,
		);
		if (
			styleMatch?.[1] &&
			looksLikeUrl(styleMatch[1]) &&
			looksLikeMedia(styleMatch[1])
		)
			return decodeURIComponent(styleMatch[1].trim());
	}

	// 5. Nested <img>, <video>, <audio> src attributes
	const nestedMedia = target.find("img, video, audio");
	for (let i = 0; i < nestedMedia.length; i++) {
		urlToTest = $(nestedMedia[i]).attr("src");
		if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest))
			return decodeURIComponent(urlToTest.trim());
	}

	// 6. Nested <a> href for links
	const nestedLink = target.find("a");
	for (let i = 0; i < nestedLink.length; i++) {
		urlToTest = $(nestedLink[i]).attr("href");
		if (urlToTest && looksLikeUrl(urlToTest))
			return decodeURIComponent(urlToTest.trim());
	}

	// 7. Fallback: Any plausible URL in outerHTML (less reliable)
	const html = $.html(target);
	if (html) {
		urlToTest = nextUsefulAbs(html);
		if (urlToTest && looksLikeMedia(urlToTest))
			return decodeURIComponent(urlToTest.trim()); // Prioritize media-like URLs from HTML
		if (urlToTest) return decodeURIComponent(urlToTest.trim()); // Or any URL if that's all
	}

	return "";
}

const ABS_URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const BORING = /^https?:\/\/(?:schema\.org|www\.w3\.org)\b/i;

function nextUsefulAbs(html: string): string {
	ABS_URL_RE.lastIndex = 0; // Reset regex state
	let match = ABS_URL_RE.exec(html);
	while (match) {
		const u = decodeURIComponent(match[0].trim());
		if (!BORING.test(u)) return u; // Return first non-boring absolute URL
		match = ABS_URL_RE.exec(html);
	}
	return "";
}

function looksLikeMedia(url: string): boolean {
	if (!url) return false;
	return /\.(jpeg|jpg|png|gif|webp|bmp|svg|mp4|m4v|mov|webm|m3u8|mp3|aac|ogg|wav)(\?|$)/i.test(
		url.split("?")[0],
	);
}


import axios from "axios";
import * as cheerio from "cheerio";
import CSSTarget from "../models/csstarget.model";

interface SuggestedSelectors {
  iterator: string;
  title: CSSTarget;
  description: CSSTarget;
  link: CSSTarget;
  enclosure: CSSTarget;
  date: CSSTarget;
  author: CSSTarget;
}

interface FlareSolverrConfig {
  enabled?: boolean;
  serverUrl?: string;
  timeout?: number;
}

export async function suggestSelectors(
  url: string,
  flaresolverr?: FlareSolverrConfig,
  cookies?: Array<{ name: string; value: string }>
): Promise<SuggestedSelectors> {
  let html: string;

  if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
    // Use FlareSolverr to fetch the page
    const flaresolverrUrl = flaresolverr.serverUrl;
    const timeout = flaresolverr.timeout || 60000;

    const flaresolverrPayload: any = {
      cmd: "request.get",
      url: url,
      maxTimeout: timeout,
    };

    // Add cookies if present
    if (cookies && cookies.length > 0) {
      flaresolverrPayload.cookies = cookies.map((c) => ({
        name: c.name,
        value: c.value,
      }));
    }

    const flaresolverrResponse = await axios.post(
      `${flaresolverrUrl}/v1`,
      flaresolverrPayload,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: timeout + 5000,
      },
    );

    if (
      flaresolverrResponse.data?.solution?.response &&
      flaresolverrResponse.data?.solution?.status === 200
    ) {
      html = flaresolverrResponse.data.solution.response;
    } else {
      throw new Error(
        `FlareSolverr failed: ${flaresolverrResponse.data?.message || "Unknown error"}`,
      );
    }
  } else {
    // Standard axios fetch
    const response = await axios.get(url);
    html = response.data;
  }

  const $ = cheerio.load(html);

  const fieldCandidates: Record<string, string[]> = {
    title: [
      "h1",
      "h2",
      "h3",
      "header h1",
      "header h2",
      "header h3",
      '[class*="title"]',
      '[id*="title"]',
      '[class*="headline"]',
      '[id*="headline"]',
      '[class*="heading"]',
      '[id*="heading"]',
      '[class*="post-title"]',
      '[id*="post-title"]',
      '[class*="entry-title"]',
      '[id*="entry-title"]',
      '[class*="article-title"]',
      '[id*="article-title"]',
      '[class*="page-title"]',
      '[id*="page-title"]',
      '[itemprop="headline"]',
      '[itemtype*="schema.org"] [itemprop="headline"]',
      '[itemtype*="schema.org/Article"] [itemprop="name"]',
      '[itemtype*="schema.org/BlogPosting"] [itemprop="name"]',
    ],
    description: [
      "p",
      "article p",
      "div p",
      "section p",
      '[class*="desc"]',
      '[id*="desc"]',
      '[class*="summary"]',
      '[id*="summary"]',
      '[class*="body"]',
      '[id*="body"]',
      '[class*="content"]',
      '[id*="content"]',
      '[class*="excerpt"]',
      '[id*="excerpt"]',
      '[class*="text"]',
      '[id*="text"]',
      '[class*="blurb"]',
      '[id*="blurb"]',
      '[itemprop="description"]',
      '[itemtype*="schema.org"] [itemprop="description"]',
      '[itemtype*="schema.org"] [itemprop="articleBody"]',
      '[itemtype*="schema.org/Article"] [itemprop="description"]',
    ],
    link: [
      "a",
      '[class*="link"]',
      '[id*="link"]',
      '[class*="url"]',
      '[id*="url"]',
      '[class*="href"]',
      '[id*="href"]',
      '[class*="readmore"]',
      '[id*="readmore"]',
      '[class*="entry-link"]',
      '[id*="entry-link"]',
      '[itemprop="url"]',
      '[itemtype*="schema.org"] [itemprop="url"]',
      '[itemtype*="schema.org/Article"] a',
      '[itemtype*="schema.org/BlogPosting"] a',
    ],
    enclosure: [
      "img",
      "video",
      "audio",
      '[class*="media"]',
      '[id*="media"]',
      '[class*="thumbnail"]',
      '[id*="thumbnail"]',
      '[class*="image"]',
      '[id*="image"]',
      '[class*="photo"]',
      '[id*="photo"]',
      '[class*="video"]',
      '[id*="video"]',
      '[class*="audio"]',
      '[id*="audio"]',
      '[itemprop="image"]',
      '[itemprop="thumbnailUrl"]',
      "figure img",
      ".post img",
      "img.attachment",
      '[itemtype*="schema.org"] [itemprop="image"]',
      '[itemtype*="schema.org/Article"] img',
      '[itemtype*="schema.org/BlogPosting"] img',
    ],
    date: [
      "time",
      "span",
      "div",
      '[class*="date"]',
      '[id*="date"]',
      '[class*="time"]',
      '[id*="time"]',
      '[class*="published"]',
      '[id*="published"]',
      '[class*="updated"]',
      '[id*="updated"]',
      '[class*="timestamp"]',
      '[id*="timestamp"]',
      '[itemprop="datePublished"]',
      '[itemprop="dateModified"]',
      "[datetime]",
      'meta[itemprop="datePublished"]',
      '[itemtype*="schema.org"] [itemprop="datePublished"]',
      '[itemtype*="schema.org"] [itemprop="dateModified"]',
      '[itemtype*="schema.org/Article"] [itemprop="datePublished"]',
      '[itemtype*="schema.org/BlogPosting"] [itemprop="datePublished"]',
    ],
    author: [
      '[class*="author"]',
      '[id*="author"]',
      '[class*="byline"]',
      '[id*="byline"]',
      '[class*="writer"]',
      '[id*="writer"]',
      '[class*="contributor"]',
      '[id*="contributor"]',
      '[class*="creator"]',
      '[id*="creator"]',
      '[class*="name"]',
      '[id*="name"]',
      '[itemprop="author"]',
      '[rel="author"]',
      '[class*="posted-by"]',
      '[id*="posted-by"]',
      '[href*="author="]',
      '[href*="/author/"]',
      '[itemtype*="schema.org"] [itemprop="author"]',
      '[itemtype*="schema.org/Person"] [itemprop="name"]',
      '[itemtype*="schema.org/Article"] [itemprop="author"]',
      '[itemtype*="schema.org/BlogPosting"] [itemprop="author"]',
    ],
  };

  const structuralIterators = [
    "ul > li",
    "ol > li",
    "nav > ul > li",
    "div[class*='post']",
    "div[class*='entry']",
    "div[class*='item']",
    "div[class*='card']",
    "[class*='feed-item']",
    "[class*='post-item']",
    "article",
    "section[class*='post']",
    "section[class*='story']",
  ].filter((sel) => $(sel).length >= 3);

  // Then combine them with your other approach:
  const parentBased = findCommonParents($, Object.values(fieldCandidates));
  const allCandidates = [...new Set([...parentBased, ...structuralIterators])];

  if (allCandidates.length === 0) {
    throw new Error("No common repeating parent structures identified.");
  }

  const iteratorSelector = allCandidates[0];
  const firstItem = $(iteratorSelector).first();
  const childSelectors = suggestChildSelectors(
    $,
    iteratorSelector,
    fieldCandidates
  );
  const rawDateText = $(iteratorSelector)
    .find(childSelectors.date.selector)
    .first()
    .text()
    .trim();
  const inferredDateFormat = detectDateFormat(rawDateText);

  const linkElem = firstItem.find(childSelectors.link.selector ?? "").first();
  const href = linkElem.attr("href");
  const isLinkRelative = isRelativeUrl(href);

  const enclosureElem = firstItem
    .find(childSelectors.enclosure.selector ?? "")
    .first();
  const src = enclosureElem.attr("src");
  const isEnclosureRelative = isRelativeUrl(src);

  const baseUrl = extractRootUrl(url);

  return {
    iterator: iteratorSelector,
    title: {
      selector: childSelectors.title.selector ?? "",
      attribute: childSelectors.title.attribute ?? "",
      stripHtml: false,
    },
    description: {
      selector: childSelectors.description.selector ?? "",
      attribute: childSelectors.description.attribute ?? "",
      stripHtml: false,
    },
    link: {
      selector: childSelectors.link.selector ?? "",
      attribute: childSelectors.link.attribute ?? "",
      isRelative: isLinkRelative,
      baseUrl: isLinkRelative ? baseUrl : undefined,
    },
    enclosure: {
      selector: childSelectors.enclosure.selector ?? "",
      attribute: childSelectors.enclosure.attribute ?? "",
      isRelative: isEnclosureRelative,
      baseUrl: isEnclosureRelative ? baseUrl : undefined,
    },
    date: {
      selector: childSelectors.date.selector ?? "",
      attribute: childSelectors.date.attribute ?? "",
      dateFormat: inferredDateFormat ?? undefined,
    },
    author: {
      selector: childSelectors.author.selector ?? "",
      attribute: childSelectors.author.attribute ?? "",
    },
  };
}

function findCommonParents(
  $: cheerio.Root,
  candidateGroups: string[][]
): string[] {
  const candidateSelectors: string[] = [];

  // First, explicitly check for known good container elements like <article>
  const semanticTags = ["article", "li", "section", "div"];

  for (const tag of semanticTags) {
    const matches = $(tag);
    if (matches.length >= 3) {
      candidateSelectors.push(tag);
    }
  }

  // If nothing semantic was found, fall back to heuristic detection
  if (candidateSelectors.length === 0) {
    const selectorCounts: Record<string, number> = {};

    // Flatten all possible selectors
    const flatSelectors = candidateGroups.flat();

    flatSelectors.forEach((sel) => {
      $(sel).each((_, el) => {
        const parent = $(el).parent();
        const tagName = parent.prop("tagName")?.toLowerCase() || "";
        const classList = (parent.attr("class") || "")
          .trim()
          .split(/\s+/)
          .join(".");
        const parentSelector = `${tagName}${classList ? "." + classList : ""}`;
        selectorCounts[parentSelector] =
          (selectorCounts[parentSelector] || 0) + 1;
      });
    });

    const sorted = Object.entries(selectorCounts).sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0 && sorted[0][1] >= 3) {
      candidateSelectors.push(sorted[0][0]);
    }
  }

  return candidateSelectors;
}

function suggestChildSelectors(
  $: cheerio.Root,
  parentSelector: string,
  fieldCandidates: Record<string, string[]>
): Record<string, CSSTarget> {
  const results: Record<string, CSSTarget> = {};

  for (const field of Object.keys(fieldCandidates)) {
    let bestScore = -Infinity;
    let bestTarget: CSSTarget = new CSSTarget("");

    for (const candidate of fieldCandidates[field]) {
      const fullSelector = `${parentSelector} ${candidate}`.trim();
      $(fullSelector).each((_, el) => {
        let localScore = scoreElementByField(field, el, $);

        if (field === "enclosure") {
          const isMediaTag =
            el.type === "tag" &&
            ["img", "video", "audio"].includes(el.tagName?.toLowerCase() || "");
          const hasValidSrc =
            isMediaTag && /^https?:\/\//i.test($(el).attr("src") || "");
          if (!hasValidSrc) {
            const nestedMediaEl = $(el)
              .find("img[src^='http'], audio[src^='http'], video[src^='http']")
              .first();
            if (nestedMediaEl.length) {
              el = nestedMediaEl.get(0);

              localScore += 20;
            }
          }
        }

        if (localScore > bestScore) {
          bestScore = localScore;

          // Compute selector *relative* to parent
          const pathFromParent = $(el)
            .parentsUntil(parentSelector)
            .toArray()
            .reverse();
          pathFromParent.push(el); // include the element itself
          const relSelector = pathFromParent
            .map((e) => {
              const tag = e.type === "tag" ? e.tagName?.toLowerCase() : "*";
              if (!tag) return "*";
              const classes = ($(e).attr("class") || "")
                .split(/\s+/)
                .filter(Boolean)
                .map((cls) => `.${cls}`)
                .join("");
              return tag + classes;
            })
            .join(" > ");

          const attr =
            field === "link" || field === "enclosure"
              ? $(el).attr("href") || $(el).attr("src")
              : undefined;
          let attribute = attr
            ? Object.keys($(el).attr() || {}).find(
                (k) => $(el).attr(k) === attr
              )
            : undefined;

          const tagName = el.type === "tag" ? el.tagName.toLowerCase() : "";
          if (field === "date" && tagName === "time") {
            const dtValue = $(el).attr("datetime");
            if (dtValue) {
              attribute = "datetime";
            }
          }

          const isRelative = attr && !/^https?:\/\//i.test(attr);
          bestTarget = new CSSTarget(
            relSelector,
            attribute,
            false,
            isRelative ? "" : undefined,
            isRelative
          );

          if (field === "date") {
            const format = detectDateFormat($(el).text());
            if (format) bestTarget.dateFormat = format;
          }
        }
      });
    }

    results[field] = bestTarget;
  }

  return results;
}

function detectDateFormat(dateStr: string): string | null {
  const patterns: { regex: RegExp; format: string }[] = [
    { regex: /^\d{4}[-/]\d{2}[-/]\d{2}/, format: "YYYY-MM-DD" },
    { regex: /^\d{2}[-/]\d{2}[-/]\d{4}/, format: "MM-DD-YYYY" },
    { regex: /^\d{2}[-/]\d{2}[-/]\d{2}/, format: "MM-DD-YY" },
    { regex: /^\d{2}\.\d{2}\.\d{4}/, format: "DD.MM.YYYY" },
    { regex: /^\d{4}\.\d{2}\.\d{2}/, format: "YYYY.MM.DD" },
    { regex: /^\d{8}$/, format: "YYYYMMDD" },
    { regex: /^\d{1,2} [A-Za-z]+ \d{4}/, format: "D MMMM YYYY" },
    { regex: /^[A-Za-z]+ \d{1,2}, \d{4}/, format: "MMMM D, YYYY" },
    { regex: /^[A-Za-z]+ \d{4}/, format: "MMMM YYYY" },
    { regex: /^\d{1,2}\/\d{1,2}\/\d{4}/, format: "M/D/YYYY" },
    { regex: /^[A-Za-z]{3} \d{1,2}, \d{4}/, format: "MMM D, YYYY" },
    { regex: /^\d{1,2} [A-Za-z]{3} \d{4}/, format: "D MMM YYYY" },
  ];

  for (const { regex, format } of patterns) {
    if (regex.test(dateStr.trim())) {
      return format;
    }
  }

  return null;
}

function isRelativeUrl(value: string | undefined): boolean {
  if (!value) return false;
  if (value.startsWith("//")) {
    return false;
  }
  return value.startsWith("/") || !/^https?:\/\//i.test(value);
}

function extractRootUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return "";
  }
}

function scoreElementByField(
  field: string,
  el: cheerio.Element,
  $: cheerio.Root
): number {
  const text = $(el).text().trim();
  const len = text.length;
  const words = text.split(/\s+/).length;
  const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";

  if (len === 0) return 0;

  let score = 0;

  if (["h1", "h2", "h3", "p", "time", "a"].includes(tag)) score += 20;
  if (["div", "span"].includes(tag)) score += 5;

  switch (field) {
    case "title":
      if (len >= 10 && len <= 100) score += 50;
      if (tag.startsWith("h")) score += 10;
      break;
    case "description":
      if (len >= 80 && len <= 600) score += 50;
      if (tag === "p") score += 10;
      break;
    case "date":
      const hasDateTokens =
        /\b\d{1,4}\b/.test(text) ||
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text);
      if (hasDateTokens) score += 50;
      if (tag === "time") score += 20;
      break;
    case "author":
      if (words >= 1 && words <= 4) score += 40;
      if (/by\s/i.test(text)) score += 10;
      break;
    case "link":
    case "enclosure":
      const attr = $(el).attr("href") || $(el).attr("src");
      if (attr) score += 30;
      if (attr && attr.startsWith("http")) score += 20;
      if (field === "enclosure") {
        if (
          ["img", "audio", "video"].includes(tag) &&
          attr &&
          /^https?:\/\//i.test(attr)
        ) {
          score += 50;
        } else {
          const nestedMedia = $(el)
            .find("img[src^='http'], audio[src^='http'], video[src^='http']")
            .first();
          if (nestedMedia.length > 0) {
            score += 30;
          }
        }
      }
      break;
  }

  if (new Set(text.split(/\s+/)).size === words) score += 10;
  if (len < 5 || words < 2) score -= 30;
  if (len > 1000) score -= 30;

  return score;
}

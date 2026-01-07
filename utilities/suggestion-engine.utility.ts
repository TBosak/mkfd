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

/**
 * Find the main content area using heuristics (inspired by Readability)
 * Returns the element most likely to contain the main content
 */
function findMainContentArea($: cheerio.Root): cheerio.Cheerio {
  // Check semantic elements first (highest confidence)
  const semanticMain = $('main, [role="main"]');
  if (semanticMain.length > 0) {
    console.log("[Content Detection] Found semantic main element");
    return semanticMain.first();
  }

  // Check for single article (common pattern)
  const articles = $('article');
  if (articles.length === 1) {
    console.log("[Content Detection] Found single article element");
    return articles.first();
  }

  // Score all candidate containers
  let bestScore = -1000;
  let bestElement = $('body');

  $('div, section, article, main').each((_, el) => {
    const $el = $(el);
    let score = 0;

    const className = ($el.attr('class') || '').toLowerCase();
    const id = ($el.attr('id') || '').toLowerCase();
    const combined = className + ' ' + id;

    // Positive signals (content indicators)
    if (/\bcontent\b|\bmain\b|\barticle\b|\bpost\b|\bentry\b|\bstory\b|\bnews\b|\bfeed\b/.test(combined)) {
      score += 25;
    }
    if (/\bcontainer\b|\bwrapper\b/.test(combined)) {
      score += 10;
    }

    // Negative signals (non-content areas)
    if (/\bnav\b|\bsidebar\b|\baside\b|\bfooter\b|\bheader\b|\bmenu\b|\bcomment\b|\bad\b|\bbanner\b/.test(combined)) {
      score -= 50;
    }
    if (/\bskip\b|\bhidden\b|\bmodal\b|\bpopup\b|\boverlay\b/.test(combined)) {
      score -= 30;
    }

    // Paragraph density (good indicator of article content)
    const paragraphs = $el.find('p').length;
    const links = $el.find('a').length;
    const headings = $el.find('h1, h2, h3, h4, h5, h6').length;

    score += paragraphs * 3;
    score += headings * 2;

    // Good paragraph-to-link ratio (articles have more text than navigation)
    if (links > 0 && paragraphs / links > 2) {
      score += 10;
    }

    // Penalize if too link-heavy (likely navigation)
    if (paragraphs > 0 && links / paragraphs > 5) {
      score -= 20;
    }

    // Prefer elements with reasonable depth (not too shallow, not too deep)
    const depth = $el.parents().length;
    if (depth > 2 && depth < 8) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestElement = $el;
    }
  });

  console.log(`[Content Detection] Best content area score: ${bestScore}`);
  return bestElement;
}

/**
 * Find repeating structures within the main content area
 */
function findRepeatingStructuresInContent(
  $content: cheerio.Root,
  minCount: number = 3
): string[] {
  const candidates: string[] = [];

  // Semantic article containers
  const semanticSelectors = [
    "article",
    "li",
    "section",
    "div[class*='post']",
    "div[class*='item']",
    "div[class*='entry']",
    "div[class*='card']",
  ];

  for (const selector of semanticSelectors) {
    const matches = $content(selector);
    if (matches.length >= minCount) {
      candidates.push(selector);
    }
  }

  return candidates;
}

/**
 * Phase 1: Choose best iterator using evidence-based ranking
 * Scores iterators based on field coverage and penalizes boilerplate/navigation
 * Returns an array of top candidates sorted by score
 */
function chooseBestIterator(
  $: cheerio.Root,
  candidates: string[],
  fieldCandidates: Record<string, string[]>,
  sampleN: number = 12
): string[] {
  // Use a subset of the full field candidates for faster iterator scoring
  // Take the first 10 selectors from each field (prioritizing high-precision ones)
  const scoringSelectors: Record<string, string[]> = {
    title: fieldCandidates.title,
    link: fieldCandidates.link,
    date: fieldCandidates.date,
    description: fieldCandidates.description,
    author: fieldCandidates.author,
  };

  const boilerplateKeywords = [
    'sign in', 'subscribe', 'home', 'menu', 'nav', 'footer',
    'cookie', 'privacy', 'terms', 'login', 'register',
  ];

  interface IteratorScore {
    selector: string;
    score: number;
    coverage: Record<string, number>;
    penalties: {
      linkDensity: number;
      boilerplate: number;
      tooShallow: number;
      overlap: number;
      size: number;
    };
  }

  const scores: IteratorScore[] = [];

  for (const candidate of candidates) {
    const items = $(candidate).slice(0, sampleN);
    if (items.length === 0) continue;

    const coverage: Record<string, number> = {};
    let totalLinkCount = 0;
    let totalTextLength = 0;
    let boilerplateCount = 0;
    let tooShallowCount = 0;

    // Improvement 1a: Check for iterator overlap (nested matches)
    let overlapCount = 0;
    items.each((_, item) => {
      const $item = $(item);
      // Check if this item contains other matched items
      const nestedMatches = $item.find(candidate);
      if (nestedMatches.length > 0) {
        overlapCount++;
      }
    });
    const overlapRatio = items.length > 0 ? overlapCount / items.length : 0;

    // Improvement 1b: Check for oversized items (likely section wrappers)
    const textLengths: number[] = [];
    const linkCounts: number[] = [];
    const headingCounts: number[] = [];

    items.each((_, item) => {
      const $item = $(item);
      const text = $item.text().trim();
      const links = $item.find('a').length;
      const headings = $item.find('h1, h2, h3, h4, h5, h6').length;

      textLengths.push(text.length);
      linkCounts.push(links);
      headingCounts.push(headings);
    });

    const medianTextLength = getMedian(textLengths);
    const medianLinkCount = getMedian(linkCounts);
    const medianHeadingCount = getMedian(headingCounts);

    // Test field coverage
    for (const [field, selectors] of Object.entries(scoringSelectors)) {
      let foundCount = 0;

      items.each((_, item) => {
        const $item = $(item);

        // Try each high-precision selector
        for (const selector of selectors) {
          const match = $item.find(selector).first();
          if (match.length > 0 && match.text().trim().length > 0) {
            foundCount++;
            break;
          }
        }
      });

      coverage[field] = items.length > 0 ? foundCount / items.length : 0;
    }

    // Calculate penalties
    items.each((_, item) => {
      const $item = $(item);
      const text = $item.text().trim().toLowerCase();
      const linkCount = $item.find('a').length;

      totalLinkCount += linkCount;
      totalTextLength += text.length;

      // Boilerplate detection
      for (const keyword of boilerplateKeywords) {
        if (text.includes(keyword)) {
          boilerplateCount++;
          break;
        }
      }

      // Too shallow (less than 20 chars)
      if (text.length < 20) {
        tooShallowCount++;
      }
    });

    const avgLinkCount = totalLinkCount / items.length;
    const avgTextLength = totalTextLength / items.length;
    const linkDensity = avgTextLength > 0 ? avgLinkCount / avgTextLength * 1000 : 0;

    // Scoring (title and link are most important)
    let score = 0;
    score += (coverage.title || 0) * 100;  // Title: weight 100
    score += (coverage.link || 0) * 80;    // Link: weight 80
    score += (coverage.date || 0) * 40;    // Date: weight 40
    score += (coverage.description || 0) * 20;  // Description: weight 20
    score += (coverage.author || 0) * 30;  // Author: weight 30

    // Penalties
    const linkDensityPenalty = linkDensity > 50 ? linkDensity : 0;
    const boilerplatePenalty = (boilerplateCount / items.length) * 50;
    const shallowPenalty = (tooShallowCount / items.length) * 30;

    // Improvement 1: Overlap and size penalties
    const overlapPenalty = overlapRatio > 0.2 ? overlapRatio * 200 : 0;
    const sizePenalty =
      (medianTextLength > 2000 ? 100 : 0) +
      (medianLinkCount > 15 ? 50 : 0) +
      (medianHeadingCount > 5 ? 50 : 0);

    score -= linkDensityPenalty;
    score -= boilerplatePenalty;
    score -= shallowPenalty;
    score -= overlapPenalty;
    score -= sizePenalty;

    scores.push({
      selector: candidate,
      score,
      coverage,
      penalties: {
        linkDensity: linkDensityPenalty,
        boilerplate: boilerplatePenalty,
        tooShallow: shallowPenalty,
        overlap: overlapPenalty,
        size: sizePenalty,
      },
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Debug output (top 3)
  console.log('[Iterator Ranking] Top 3 candidates:');
  for (let i = 0; i < Math.min(3, scores.length); i++) {
    const s = scores[i];
    console.log(`  ${i + 1}. ${s.selector}`);
    console.log(`     Score: ${s.score.toFixed(1)}`);
    console.log(`     Coverage: title=${(s.coverage.title * 100).toFixed(0)}% link=${(s.coverage.link * 100).toFixed(0)}% desc=${(s.coverage.description * 100).toFixed(0)}% author=${(s.coverage.author * 100).toFixed(0)}% date=${(s.coverage.date * 100).toFixed(0)}%`);
    console.log(`     Penalties: linkDensity=${s.penalties.linkDensity.toFixed(1)} boilerplate=${s.penalties.boilerplate.toFixed(1)} shallow=${s.penalties.tooShallow.toFixed(1)} overlap=${s.penalties.overlap.toFixed(1)} size=${s.penalties.size.toFixed(1)}`);
  }

  // Return top 5 candidates (or all if fewer), filtering out those with negative scores
  const viableCandidates = scores
    .filter(s => s.score > 0)
    .slice(0, 5)
    .map(s => s.selector);

  // Fallback to first candidate if no viable ones
  return viableCandidates.length > 0 ? viableCandidates : [candidates[0]];
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

  // Parse the full page with Cheerio
  const $ = cheerio.load(html);
  const $content = $;

const fieldCandidates: Record<string, string[]> = {
  title: [
    // Structured data
    '[itemprop="headline"]',
    '[itemprop="name"]',
    '[itemtype*="schema.org/Article"] [itemprop="headline"]',
    '[itemtype*="schema.org/BlogPosting"] [itemprop="headline"]',
    '[itemtype*="schema.org/Article"] [itemprop="name"]',
    '[itemtype*="schema.org/BlogPosting"] [itemprop="name"]',
    // Microformats
    '.p-name',
    '.entry-title',
    '.post-title',
    '.article-title',
    '.headline',
    '.title',
    '.story-title',
    '.card-title',
    '.teaser-title',
    // Table-specific (Hacker News, 1337x, etc.)
    'td.title a',
    'td.name a',
    'td[class*="title"] a',
    'td[class*="name"] a',
    '.titleline a',
    'td.title .titleline a',
    // Generic patterns
    '[class*="headline"]',
    '[class*="title"]',
    '[class*="heading"]',
    '[class*="teaser"] [class*="title"]',
    '[class*="card"] [class*="title"]',
    // Data attributes
    '[data-testid*="headline"]',
    '[data-testid*="title"]',
    '[data-qa*="headline"]',
    '[data-qa*="title"]',
    // ARIA
    '[role="heading"]',
    '[aria-level]',
    // Headings
    "header h1",
    "header h2",
    "header h3",
    "h1",
    "h2",
    "h3",
  ],

  description: [
    '[itemprop="description"]',
    '[itemprop="articleBody"]',
    '[itemtype*="schema.org/Article"] [itemprop="description"]',
    '[itemtype*="schema.org/Article"] [itemprop="articleBody"]',
    '.p-summary',
    '.entry-summary',
    '.entry-content',
    '.post-excerpt',
    '.excerpt',
    '.summary',
    '.dek',
    '.standfirst',
    '.subhead',
    '.subtitle',
    '[class*="excerpt"]',
    '[class*="summary"]',
    '[class*="content"]',
    '[class*="body"]',
    '[class*="description"]',
    '[class*="dek"]',
    '[class*="standfirst"]',
    '[data-testid*="summary"]',
    '[data-testid*="description"]',
    '[data-qa*="summary"]',
    '[data-qa*="description"]',
    "article p",
    "section p",
    "div p",
    "p",
  ],

  link: [
    '[itemprop="url"]',
    '[itemtype*="schema.org/Article"] [itemprop="url"]',
    '[itemtype*="schema.org/BlogPosting"] [itemprop="url"]',
    'a[rel="bookmark"]',
    'a[rel="canonical"]',
    '.u-url',
    '.entry-title a',
    '.post-title a',
    '.article-title a',
    '.headline a',
    '[class*="readmore"] a',
    '[class*="read-more"] a',
    '[class*="readMore"] a',
    '[aria-label*="Read"]',
    '[aria-label*="read"]',
    '[data-testid*="link"] a',
    '[data-qa*="link"] a',
    "h1 a",
    "h2 a",
    "h3 a",
    "a",
  ],

  enclosure: [
    '[itemprop="image"]',
    '[itemprop="thumbnailUrl"]',
    '[itemtype*="schema.org"] [itemprop="image"]',
    "figure img",
    "picture img",
    ".wp-post-image",
    ".attachment img",
    ".thumbnail img",
    ".thumb img",
    ".hero img",
    ".lead img",
    '[class*="hero"] img',
    '[class*="thumb"] img',
    '[class*="thumbnail"] img',
    '[class*="image"] img',
    '[class*="photo"] img',
    "img",
    "video source",
    "video",
    "audio source",
    "audio",
  ],

  date: [
    // Structured data
    'time[datetime]',
    '[itemprop="datePublished"]',
    '[itemprop="dateModified"]',
    '[itemtype*="schema.org"] [itemprop="datePublished"]',
    '[itemtype*="schema.org"] [itemtype*="schema.org"] [itemprop="dateModified"]',
    // Microformats
    ".dt-published",
    ".dt-updated",
    // Table-specific (1337x, torrent sites, HN)
    'td[class*="date"]',
    'td[class*="time"]',
    'td.coll-date',
    '.age',
    '.age a',
    'span.age',
    // Generic patterns
    '[class*="publish"]',
    '[class*="published"]',
    '[class*="update"]',
    '[class*="updated"]',
    '[class*="timestamp"]',
    '[class*="date"]',
    '[class*="time"]',
    // Data attributes
    '[data-testid*="date"]',
    '[data-testid*="time"]',
    '[data-qa*="date"]',
    '[data-qa*="time"]',
    // Fallback
    "time",
  ],

  author: [
    // Structured data
    '[itemprop="author"] [itemprop="name"]',
    '[itemprop="author"]',
    '[rel="author"]',
    'a[rel="author"]',
    'meta[name="author"]',
    // Microformats
    ".p-author",
    ".byline",
    ".author",
    ".writer",
    ".contributor",
    // Author links (high priority - often contain author name)
    'a[href*="author"]',  // Catches /author/, author=, archive?author=, etc.
    'a[href*="/user/"]',
    'a[href*="/writer/"]',
    'a[href*="/contributor/"]',
    'a[href*="/by/"]',
    // Generic patterns
    '[class*="byline"]',
    '[class*="author"]',
    '[class*="writer"]',
    '[class*="contributor"]',
    '[class*="posted-by"]',
    '[class*="uploader"]',
    '[class*="posted_by"]',
    // Data attributes
    '[data-testid*="author"]',
    '[data-qa*="author"]',
  ],
};

const contentIterators = findRepeatingStructuresInContent($content, 3);

const structuralIterators = [
  // Articles
  "main article",
  "article",
  '[role="article"]',

  // Lists
  "ul > li",
  "ol > li",
  '[role="list"] > [role="listitem"]',

  // Tables (prioritize specific over generic)
  "tr",
  "tr.submission",
  "tr[class*='item']",
  "tr[class*='row']",
  "tbody > tr",
  "table.table-list tbody tr",
  "table[class*='list'] tbody tr",
  "table[class*='result'] tbody tr",
  "table tbody tr",
  "table > tbody > tr",
  "table > tr",
  "table tr",

  // ARIA tables
  '[role="table"] [role="row"]',
  '[role="grid"] [role="row"]',
  '[role="rowgroup"] > [role="row"]',

  // Feed items
  "[class*='feed-item']",
  "[class*='post-item']",
  "[class*='list-item']",
  "[class*='result']",
  "[class*='search-result']",
  "[class*='story']",
  "[class*='teaser']",
  "[class*='card']",

  // Divs & sections
  "div[class*='post']",
  "div[class*='entry']",
  "div[class*='item']",
  "section[class*='post']",
  "section[class*='story']",

  // Data attributes
  "[data-testid*='card']",
  "[data-testid*='story']",
  "[data-qa*='card']",
  "[data-qa*='story']",
].filter((sel) => $content(sel).length >= 3);

  // Combine all iterator candidates
  // Priority: structural patterns > content-based patterns > parent-based heuristics
  const parentBased = findCommonParents($content, Object.values(fieldCandidates));
  const allCandidates = [...new Set([...structuralIterators, ...contentIterators, ...parentBased])];

  if (allCandidates.length === 0) {
    throw new Error("No common repeating parent structures identified.");
  }

  // Phase 1: Choose best iterator candidates using evidence-based ranking
  const iteratorCandidates = chooseBestIterator($content, allCandidates, fieldCandidates, 12);

  // Improvement 3: Validate iterator based on unique links
  let iteratorSelector = "";
  let childSelectors: Record<string, CSSTarget> = {};
  let inferredDateFormat: string | null = null;
  let isLinkRelative = false;
  let isEnclosureRelative = false;

  for (const candidate of iteratorCandidates) {
    const items = $content(candidate).slice(0, 12);
    if (items.length === 0) continue;

    // Try to get child selectors for this iterator
    const tempChildSelectors = suggestChildSelectors(
      $content,
      candidate,
      fieldCandidates
    );

    // Extract links and descriptions from all items
    const links: string[] = [];
    let itemsWithDescription = 0;

    items.each((_, item) => {
      const $item = $content(item);

      // Check for link
      const linkMatch = $item.find(tempChildSelectors.link.selector ?? "").first();
      const href = linkMatch.attr("href");
      if (href) {
        // Normalize the link
        const normalized = href.toLowerCase().trim();
        if (
          normalized !== "#" &&
          !normalized.startsWith("javascript:") &&
          !normalized.startsWith("data:") &&
          !normalized.startsWith("vbscript:") &&
          !normalized.startsWith("mailto:")
        ) {
          links.push(normalized);
        }
      }

      // Check for description (helps filter out nav links)
      const descMatch = $item.find(tempChildSelectors.description.selector ?? "").first();
      const descText = descMatch.text().trim();
      if (descText && descText.length > 20) {
        itemsWithDescription++;
      }
    });

    // Check unique links requirement
    // We need at least 2 unique links, or 40% of items (whichever is greater, up to 5)
    const uniqueLinks = new Set(links);
    const minRequiredLinks = Math.max(2, Math.min(5, Math.ceil(items.length * 0.4)));

    // Also prefer iterators where at least 30% of items have descriptions (filters nav)
    const descriptionCoverage = items.length > 0 ? itemsWithDescription / items.length : 0;
    const hasGoodDescriptionCoverage = descriptionCoverage >= 0.3;

    if (uniqueLinks.size >= minRequiredLinks && hasGoodDescriptionCoverage) {
      // This iterator is viable!
      console.log(`[Iterator Validation] Selected "${candidate}" with ${uniqueLinks.size} unique links, ${(descriptionCoverage * 100).toFixed(0)}% description coverage`);
      iteratorSelector = candidate;
      childSelectors = tempChildSelectors;

      const rawDateText = items
        .find(tempChildSelectors.date.selector)
        .first()
        .text()
        .trim();
      inferredDateFormat = detectDateFormat(rawDateText);

      // Check multiple items to determine if links/enclosures are relative
      // (first item might be different, e.g., featured article)
      let relativeLinksCount = 0;
      let absoluteLinksCount = 0;
      let relativeEnclosuresCount = 0;
      let absoluteEnclosuresCount = 0;

      items.slice(0, 5).each((_, item) => {
        const $item = $content(item);

        const linkElem = $item.find(tempChildSelectors.link.selector ?? "").first();
        const href = linkElem.attr("href");
        if (href) {
          if (isRelativeUrl(href)) {
            relativeLinksCount++;
          } else {
            absoluteLinksCount++;
          }
        }

        const enclosureElem = $item.find(tempChildSelectors.enclosure.selector ?? "").first();
        const src = enclosureElem.attr("src");
        if (src) {
          if (isRelativeUrl(src)) {
            relativeEnclosuresCount++;
          } else {
            absoluteEnclosuresCount++;
          }
        }
      });

      // Use majority vote
      isLinkRelative = relativeLinksCount > absoluteLinksCount;
      isEnclosureRelative = relativeEnclosuresCount > absoluteEnclosuresCount;

      console.log(`[Link Detection] ${relativeLinksCount} relative, ${absoluteLinksCount} absolute → isRelative: ${isLinkRelative}`);
      if (relativeEnclosuresCount + absoluteEnclosuresCount > 0) {
        console.log(`[Enclosure Detection] ${relativeEnclosuresCount} relative, ${absoluteEnclosuresCount} absolute → isRelative: ${isEnclosureRelative}`);
      }

      break; // Found a good iterator, stop searching
    } else {
      const reasons = [];
      if (uniqueLinks.size < minRequiredLinks) {
        reasons.push(`${uniqueLinks.size} unique links (need ${minRequiredLinks})`);
      }
      if (!hasGoodDescriptionCoverage) {
        reasons.push(`${(descriptionCoverage * 100).toFixed(0)}% description coverage (need 30%)`);
      }
      console.log(`[Iterator Validation] Rejected "${candidate}" - ${reasons.join(', ')}`);
    }
  }

  // If no iterator passed validation, use the first candidate as fallback
  if (!iteratorSelector && iteratorCandidates.length > 0) {
    console.log("[Iterator Validation] No iterator passed validation, using first candidate as fallback");
    iteratorSelector = iteratorCandidates[0];
    childSelectors = suggestChildSelectors($content, iteratorSelector, fieldCandidates);

    const items = $content(iteratorSelector).slice(0, 12);
    const rawDateText = items.find(childSelectors.date.selector).first().text().trim();
    inferredDateFormat = detectDateFormat(rawDateText);

    // Check multiple items to determine if links/enclosures are relative
    let relativeLinksCount = 0;
    let absoluteLinksCount = 0;
    let relativeEnclosuresCount = 0;
    let absoluteEnclosuresCount = 0;

    items.slice(0, 5).each((_, item) => {
      const $item = $content(item);

      const linkElem = $item.find(childSelectors.link.selector ?? "").first();
      const href = linkElem.attr("href");
      if (href) {
        if (isRelativeUrl(href)) {
          relativeLinksCount++;
        } else {
          absoluteLinksCount++;
        }
      }

      const enclosureElem = $item.find(childSelectors.enclosure.selector ?? "").first();
      const src = enclosureElem.attr("src");
      if (src) {
        if (isRelativeUrl(src)) {
          relativeEnclosuresCount++;
        } else {
          absoluteEnclosuresCount++;
        }
      }
    });

    // Use majority vote
    isLinkRelative = relativeLinksCount > absoluteLinksCount;
    isEnclosureRelative = relativeEnclosuresCount > absoluteEnclosuresCount;

    console.log(`[Link Detection] ${relativeLinksCount} relative, ${absoluteLinksCount} absolute → isRelative: ${isLinkRelative}`);
    if (relativeEnclosuresCount + absoluteEnclosuresCount > 0) {
      console.log(`[Enclosure Detection] ${relativeEnclosuresCount} relative, ${absoluteEnclosuresCount} absolute → isRelative: ${isEnclosureRelative}`);
    }
  }

  const baseUrl = extractRootUrl(url);
  console.log(`[Selector Suggestion] Returning selectors for iterator: ${iteratorSelector}`);

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
      relativeLink: isLinkRelative,  // Frontend expects 'relativeLink'
      rootUrl: isLinkRelative ? baseUrl : undefined,  // Frontend expects 'rootUrl'
    },
    enclosure: {
      selector: childSelectors.enclosure.selector ?? "",
      attribute: childSelectors.enclosure.attribute ?? "",
      relativeLink: isEnclosureRelative,  // Frontend expects 'relativeLink'
      rootUrl: isEnclosureRelative ? baseUrl : undefined,  // Frontend expects 'rootUrl'
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

/**
 * Check if a selector is a bare tag (generic, low specificity)
 */
function isBareTagSelector(sel: string): boolean {
  return /^(h[1-6]|p|a|img|time|span|div|li|section|article)$/.test(sel.trim());
}

/**
 * Calculate specificity bonus based on selector complexity
 */
function specificityBonus(sel: string): number {
  const ids = (sel.match(/#/g) || []).length;
  const classes = (sel.match(/\./g) || []).length;
  const attrs = (sel.match(/\[/g) || []).length;
  const combinators = (sel.match(/[>+~]/g) || []).length;
  return ids * 8 + classes * 3 + attrs * 3 + combinators * 1;
}

/**
 * Calculate title-link affinity bonus for title selectors
 */
function titleLinkAffinity($item: cheerio.Cheerio, candidate: string): number {
  const el = $item.find(candidate).first();
  if (!el.length) return 0;

  const hasAnchorChild = el.find('a[href]').length > 0;
  const isAnchor = el.is('a[href]');
  const isInsideAnchor = el.closest('a[href]').length > 0;

  return (hasAnchorChild ? 20 : 0) + (isAnchor ? 30 : 0) + (isInsideAnchor ? 15 : 0);
}

/**
 * Fix 4: Create CSS module prefix selector from a class name
 */
function cssModulePrefixSelector(className: string): string | null {
  const idx = className.lastIndexOf("__");
  if (idx <= 0) return null;
  const prefix = className.slice(0, idx + 2); // keep trailing "__"
  return `[class^="${prefix}"]`;
}

/**
 * Fix 4: Generate stable selector from element (handles CSS modules)
 */
function stableSelectorFromElement($el: cheerio.Cheerio): string {
  const tag = ($el.get(0) as any)?.tagName?.toLowerCase?.() || "";
  const classes = ($el.attr("class") || "").split(/\s+/).filter(Boolean);

  // Prefer CSS-module prefixes if present
  const prefixes = classes
    .map(cssModulePrefixSelector)
    .filter((x): x is string => !!x);

  if (prefixes.length) {
    // Pick the most specific-looking one (longer prefix tends to be more specific)
    prefixes.sort((a, b) => b.length - a.length);
    return `${tag}${prefixes[0]}`.trim();
  }

  // Fallback: first class (non-hashed) if any
  if (classes.length) return `${tag}.${classes[0]}`;

  return tag || "";
}

/**
 * Phase 6: Detect iterator mode (table vs card vs article)
 */
function detectIteratorMode(parentSelector: string): "table" | "card" | "article" {
  const selector = parentSelector.toLowerCase();

  // Table mode: tr or ARIA row patterns
  if (selector.includes("tr") ||
      selector.includes('[role="row"]') ||
      selector.includes('tbody') ||
      selector.includes('table')) {
    return "table";
  }

  // Article mode
  if (selector.includes("article")) {
    return "article";
  }

  // Default: card/generic
  return "card";
}

/**
 * Phase 2: Per-item aggregate scoring for child selectors
 * Evaluates selectors across multiple items and aggregates statistics
 * Phase 6: Enhanced with table-mode specific heuristics
 */
function suggestChildSelectors(
  $: cheerio.Root,
  parentSelector: string,
  fieldCandidates: Record<string, string[]>,
  sampleN: number = 12
): Record<string, CSSTarget> {
  const results: Record<string, CSSTarget> = {};
  const items = $(parentSelector).slice(0, sampleN);

  if (items.length === 0) {
    // Fallback: return empty selectors
    for (const field of Object.keys(fieldCandidates)) {
      results[field] = new CSSTarget("");
    }
    return results;
  }

  // Phase 6: Detect mode and apply table-specific heuristics
  const mode = detectIteratorMode(parentSelector);
  const isTableMode = mode === "table";

  // Table mode: adjust field candidates with table-specific selectors
  if (isTableMode) {
    console.log("[Table Mode] Detected table-based iterator, using table-specific heuristics");

    // For tables, prioritize cell-based selectors
    fieldCandidates = {
      ...fieldCandidates,
      title: [
        'td.name a',
        'td.title a',
        'td[class*="title"] a',
        'td[class*="name"] a',
        'td.coll-1 a',
        'td:first-child a',
        'a',
        ...fieldCandidates.title,
      ],
      link: [
        'td.name a',
        'td.title a',
        'td[class*="title"] a',
        'td:first-child a',
        'a',
        ...fieldCandidates.link,
      ],
      date: [
        'td[class*="date"]',
        'td[class*="time"]',
        'td.coll-date',
        'time',
        ...fieldCandidates.date,
      ],
      description: [
        // Tables rarely have descriptions - keep minimal
        'td[class*="desc"]',
        'td[class*="summary"]',
      ],
    };
  }

  for (const field of Object.keys(fieldCandidates)) {
    interface CandidateStats {
      selector: string;
      score: number;
      coverage: number;
      uniqueRatio: number;
      avgMatches: number;
      avgLen: number;
      values: string[];
      elements: cheerio.Element[];
    }

    const candidateStats: CandidateStats[] = [];

    for (const candidate of fieldCandidates[field]) {
      const values: string[] = [];
      const elements: cheerio.Element[] = [];
      let totalMatches = 0;
      let totalLen = 0;
      let nonEmptyCount = 0;

      // Fix 1: Track how many items actually match this selector
      let matchCount = 0;

      // Evaluate across all items
      items.each((_, item) => {
        const $item = $(item);
        const matches = $item.find(candidate);
        totalMatches += matches.length;

        // Track if this item has a match
        if (matches.length > 0) matchCount++;

        // Take first match
        const chosen = matches.first();
        if (chosen.length > 0) {
          const value = extractValue(field, chosen, $);
          if (value && value.length > 0) {
            values.push(value);
            elements.push(chosen.get(0)!);
            nonEmptyCount++;
            totalLen += value.length;
          }
        }
      });

      // Fix 1: Require selector to match at least 2 items
      // This prevents selectors that only match a single hero/ad card
      if (matchCount < 2) {
        continue; // Skip this candidate
      }

      // Calculate aggregate statistics
      const coverage = items.length > 0 ? nonEmptyCount / items.length : 0;
      const uniqueValues = new Set(values);
      const uniqueRatio = nonEmptyCount > 0 ? uniqueValues.size / nonEmptyCount : 0;
      const avgMatches = items.length > 0 ? totalMatches / items.length : 0;
      const avgLen = nonEmptyCount > 0 ? totalLen / nonEmptyCount : 0;

      // Scoring
      let score = 0;

      // Strong reward for coverage and uniqueness
      score += coverage * 100;
      if (field === "author") {
        // Soft uniqueness: only reward when it's not all the same
        // (helps multi-author lists without punishing single-author archives)
        const authorUniqBonus = Math.max(0, (uniqueRatio - 0.2)) * 20;
        score += authorUniqBonus;
      } else {
        score += uniqueRatio * 50;
      }

      // Strong penalty for too many matches per item (too broad)
      if (avgMatches > 1.5) {
        const mult = field === "author" ? 10 : 30;
        score -= (avgMatches - 1) * mult;
      }

      // Fix 2: Add specificity bonus
      score += specificityBonus(candidate);

      // Fix 2: Penalize bare tag selectors (h2, a, img, etc.)
      if (isBareTagSelector(candidate)) {
        const penalty =
          field === "title" ? 80 :
          field === "link" ? 80 :
          field === "date" ? 40 :
          field === "description" ? 30 :
          field === "enclosure" ? 30 : 20;

        score -= penalty;
      }

      // Fix 3: Title-link affinity bonus for titles
      if (field === "title") {
        let totalAffinity = 0;
        items.each((_, item) => {
          totalAffinity += titleLinkAffinity($(item), candidate);
        });
        score += totalAffinity / items.length;
      }

      // Improvement 2: Dominant value penalty
      // If one value appears too frequently, it's likely a shared header/section title
      if (nonEmptyCount > 0) {
        const valueCounts = new Map<string, number>();
        for (const val of values) {
          const normalized = val.toLowerCase().trim();
          valueCounts.set(normalized, (valueCounts.get(normalized) || 0) + 1);
        }

        const maxCount = Math.max(...valueCounts.values());
        const dominanceRatio = maxCount / nonEmptyCount;

        // Apply penalty based on field type and dominance
        if (field === "title" || field === "link") {
          // Title and link should be very unique - penalize if >35% are the same
          if (dominanceRatio > 0.35) {
            score -= (dominanceRatio - 0.35) * 300; // Heavy penalty
          }
        } else if (field === "description") {
          // Description can be somewhat repeated but not too much
          if (dominanceRatio > 0.5) {
            score -= (dominanceRatio - 0.5) * 200;
          }
        } else if (field === "date") {
          // Dates can be the same for items published at the same time
          // More lenient - only penalize if >70% are identical
          if (dominanceRatio > 0.7) {
            score -= (dominanceRatio - 0.7) * 150;
          }
        }
      }

      // Field-specific scoring
      if (field === "title") {
        // Prefer moderate length titles
        if (avgLen >= 10 && avgLen <= 100) score += 20;
        if (avgLen < 5) score -= 30;
      } else if (field === "description") {
        // Prefer longer descriptions
        if (avgLen >= 50 && avgLen <= 600) score += 20;
        if (avgLen < 20) score -= 20;
      } else if (field === "date") {
        // Prefer elements with date tokens
        const hasDateTokens = values.some(v =>
          /\b\d{1,4}\b/.test(v) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(v)
        );
        if (hasDateTokens) score += 30;
      } else if (field === "link") {
        // Prefer valid URLs
        const validUrls = values.filter(v => {
          if (!v) return false;
          const vNorm = v.toLowerCase();
          return (
            vNorm.length > 0 &&
            !vNorm.startsWith('#') &&
            !vNorm.startsWith('javascript:') &&
            !vNorm.startsWith('data:') &&
            !vNorm.startsWith('vbscript:') &&
            !vNorm.startsWith('mailto:')
          );
        }).length;
        if (validUrls > 0) score += (validUrls / values.length) * 30;
      } else if (field === "author") {
        // Look for name pattern: 2 capitalized words (e.g., "Matt Tabak", "John Smith")
        const namePattern = /^[A-Z][a-z]+\s+[A-Z][a-z]+$/;
        const nameCount = values.filter(v => namePattern.test(v.trim())).length;
        if (nameCount > 0) {
          score += (nameCount / values.length) * 50;  // Strong bonus for name pattern
        }

        // Check if selector or parent contains "author" in class/id/href
        const selectorLower = candidate.toLowerCase();
        const hasAuthorContext = /author|byline|writer|contributor|posted-by/i.test(selectorLower);
        if (hasAuthorContext) {
          score += 40;
        }

        // Also check parent elements for author context
        let parentAuthorBonus = 0;
        elements.forEach(el => {
          const $el = $(el);
          const parent = $el.parent();
          const parentClass = (parent.attr('class') || '').toLowerCase();
          const parentId = (parent.attr('id') || '').toLowerCase();
          if (/author|byline|writer|contributor/i.test(parentClass + ' ' + parentId)) {
            parentAuthorBonus++;
          }
        });
        if (parentAuthorBonus > 0) {
          score += (parentAuthorBonus / elements.length) * 30;
        }

        // Prefer reasonable name length
        if (avgLen >= 5 && avgLen <= 50) score += 20;
        if (avgLen < 3 || avgLen > 100) score -= 30;
      }

      // Penalize suspicious values (boilerplate)
      const boilerplatePattern = /sign in|subscribe|read more|continue reading|home|menu/i;
      const boilerplateCount = values.filter(v => boilerplatePattern.test(v)).length;
      if (boilerplateCount > 0) {
        score -= (boilerplateCount / values.length) * 40;
      }

      candidateStats.push({
        selector: candidate,
        score,
        coverage,
        uniqueRatio,
        avgMatches,
        avgLen,
        values,
        elements,
      });
    }

    // Sort by score
    candidateStats.sort((a, b) => b.score - a.score);

    // Phase 5: Apply proximity tie-breakers if top candidates are close in score
    if (candidateStats.length > 1) {
      const topScore = candidateStats[0].score;
      const closeScorers = candidateStats.filter(c => c.score >= topScore * 0.9);

      if (closeScorers.length > 1) {
        if (field === "link" && results.title?.selector) {
          // Re-score links based on proximity to title
          for (const candidate of closeScorers) {
            const proximityBonus = calculateProximityToTitle(
              $,
              candidate.elements,
              results.title.selector,
              items
            );
            candidate.score += proximityBonus;
          }

          candidateStats.sort((a, b) => b.score - a.score);
        } else if (field === "date") {
          // Re-score dates based on position in item (prefer top)
          const titleSel = results.title?.selector || "";
          for (const candidate of closeScorers) {
            const positionBonus = calculateDatePositionBonus(
              $,
              candidate.elements,
              titleSel,
              items
            );
            candidate.score += positionBonus;
          }

          candidateStats.sort((a, b) => b.score - a.score);
        }
      }
    }

    const best = candidateStats[0];

    if (!best || best.elements.length === 0) {
      results[field] = new CSSTarget("");
      continue;
    }

    // Use the first element to build the selector
    const el = best.elements[0];
    const $el = $(el);

    // Phase 3: Minimize selector to shortest stable form
    const relSelector = minimizeSelector($, el, parentSelector, items, field);

    // Phase 4: Determine attribute with deterministic priority
    let attribute: string | undefined;
    const tagName = el.type === "tag" ? el.tagName.toLowerCase() : "";

    if (field === "link") {
      // Always use href for links
      attribute = "href";
    } else if (field === "enclosure") {
      // Determine which lazy-load attribute is present (in priority order)
      const lazyAttrs = ["src", "data-src", "data-lazy-src", "data-original", "data-url"];
      for (const attr of lazyAttrs) {
        if ($el.attr(attr)) {
          attribute = attr;
          break;
        }
      }
      // Check srcset
      if (!attribute && $el.attr("srcset")) {
        attribute = "srcset";
      }
      // Check poster for video
      if (!attribute && tagName === "video" && $el.attr("poster")) {
        attribute = "poster";
      }
    } else if (field === "date" && tagName === "time") {
      const dtValue = $el.attr("datetime");
      if (dtValue) attribute = "datetime";
    }

    const attrValue = attribute ? $el.attr(attribute) : undefined;
    const isRelative = attrValue && !/^https?:\/\//i.test(attrValue);

    const target = new CSSTarget(
      relSelector,
      attribute,
      false,
      isRelative ? "" : undefined,
      isRelative
    );

    if (field === "date" && best.values.length > 0) {
      const format = detectDateFormat(best.values[0]);
      if (format) target.dateFormat = format;
    }

    results[field] = target;
  }

  return results;
}

/**
 * Phase 4: Extract value from an element for a specific field with deterministic attribute handling
 */
function extractValue(
  field: string,
  $el: cheerio.Cheerio,
  $: cheerio.Root
): string {
  if ($el.length === 0) return "";

  const el = $el.get(0)!;
  const tagName = el.type === "tag" ? el.tagName.toLowerCase() : "";

  if (field === "link") {
    // Deterministically choose href attribute
    let href = $el.attr("href");

    // If element is not an anchor, find nearest anchor
    if (tagName !== "a") {
      const nearestAnchor = $el.find("a[href]").first();
      if (nearestAnchor.length > 0) {
        href = nearestAnchor.attr("href");
      }
    }

    // Reject invalid hrefs
    if (!href || href === "#" || href === "" ||
        href.startsWith("javascript:") ||
        href.startsWith("data:") ||
        href.startsWith("vbscript:") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")) {
      return "";
    }

    return href;
  } else if (field === "enclosure") {
    // Phase 4: Support modern lazyload patterns in priority order
    const lazyAttrs = [
      "src",
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-url",
    ];

    // Try each attribute in order
    for (const attr of lazyAttrs) {
      const value = $el.attr(attr);
      if (value) {
        // Reject data: URIs
        if (value.startsWith("data:")) continue;

        // Reject tiny tracking pixels (1x1 in filename)
        if (/1x1|1px|tracking|pixel/i.test(value)) continue;

        return value;
      }
    }

    // Try srcset
    const srcset = $el.attr("srcset");
    if (srcset) {
      const firstUrl = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (firstUrl && !firstUrl.startsWith("data:")) {
        return firstUrl;
      }
    }

    // Try <source srcset> within <picture>
    if (tagName === "picture") {
      const source = $el.find("source[srcset]").first();
      const sourceSrcset = source.attr("srcset");
      if (sourceSrcset) {
        const firstUrl = sourceSrcset.split(",")[0]?.trim().split(/\s+/)[0];
        if (firstUrl && !firstUrl.startsWith("data:")) {
          return firstUrl;
        }
      }
    }

    // Try poster for video
    if (tagName === "video") {
      const poster = $el.attr("poster");
      if (poster && !poster.startsWith("data:")) {
        return poster;
      }
    }

    return "";
  } else if (field === "date") {
    // Prefer time[datetime]
    if (tagName === "time") {
      const datetime = $el.attr("datetime");
      if (datetime) return datetime;
    }
    // Fall back to text with date tokens
    return $el.text().trim();
  } else if (field === "author") {
    if (tagName === "meta") return ($el.attr("content") || "").trim();
    // Prefer anchor text for authors
    if (tagName === "a") {
      return $el.text().trim();
    }
    // Check for nested anchor
    const anchor = $el.find("a").first();
    if (anchor.length > 0) {
      return anchor.text().trim();
    }
    return $el.text().trim();
  }

  return $el.text().trim();
}

/**
 * Phase 5: Calculate proximity bonus for link/date candidates based on their distance to title
 * Returns a bonus score (0-30) based on structural proximity
 */
function calculateProximityToTitle(
  $: cheerio.Root,
  elements: cheerio.Element[],
  titleSelector: string,
  items: cheerio.Cheerio
): number {
  if (!titleSelector || elements.length === 0) return 0;

  let totalProximity = 0;
  let validCount = 0;

  items.each((idx, item) => {
    if (idx >= elements.length) return;

    const $item = $(item);
    const candidateEl = elements[idx];
    if (!candidateEl) return;

    const $candidate = $(candidateEl);
    const $title = $item.find(titleSelector).first();

    if ($title.length === 0) return;

    // Check if candidate is the title anchor itself (highest bonus)
    const titleAnchor = $title.is('a') ? $title : $title.find('a').first();
    if (titleAnchor.length > 0 && titleAnchor.get(0) === candidateEl) {
      totalProximity += 30;
      validCount++;
      return;
    }

    // Check if candidate and title share a close common ancestor
    const titleParents = $title.parents().toArray();
    const candidateParents = $candidate.parents().toArray();

    // Find closest common ancestor
    let closestCommonDepth = -1;
    for (let i = 0; i < titleParents.length; i++) {
      const idx = candidateParents.indexOf(titleParents[i]);
      if (idx >= 0) {
        closestCommonDepth = Math.min(i, idx);
        break;
      }
    }

    if (closestCommonDepth >= 0) {
      // Closer common ancestor = higher bonus
      // Depth 0 (same parent) = 25 points
      // Depth 1 = 20 points
      // Depth 2 = 15 points
      // Depth 3+ = 10 points
      if (closestCommonDepth === 0) {
        totalProximity += 25;
      } else if (closestCommonDepth === 1) {
        totalProximity += 20;
      } else if (closestCommonDepth === 2) {
        totalProximity += 15;
      } else {
        totalProximity += 10;
      }
      validCount++;
    }
  });

  return validCount > 0 ? totalProximity / validCount : 0;
}

/**
 * Phase 5: Calculate proximity bonus for date candidates based on their position in item
 * Returns a bonus score (0-20) based on position (prefer top of item)
 */
function calculateDatePositionBonus(
  $: cheerio.Root,
  elements: cheerio.Element[],
  titleSelector: string,
  items: cheerio.Cheerio
): number {
  if (elements.length === 0) return 0;

  let totalBonus = 0;
  let validCount = 0;

  items.each((idx, item) => {
    if (idx >= elements.length) return;

    const $item = $(item);
    const candidateEl = elements[idx];
    if (!candidateEl) return;

    const $candidate = $(candidateEl);

    // Get all text nodes/elements in item
    const allElements = $item.find('*').addBack().toArray();
    const candidateIndex = allElements.indexOf(candidateEl);

    if (candidateIndex >= 0) {
      const position = candidateIndex / Math.max(allElements.length, 1);

      // Top 25% of item = 20 points
      // Top 50% = 15 points
      // Top 75% = 10 points
      // Bottom 25% = 5 points
      if (position <= 0.25) {
        totalBonus += 20;
      } else if (position <= 0.5) {
        totalBonus += 15;
      } else if (position <= 0.75) {
        totalBonus += 10;
      } else {
        totalBonus += 5;
      }
      validCount++;
    }

    // Additional bonus if near title
    if (titleSelector) {
      const $title = $item.find(titleSelector).first();
      if ($title.length > 0) {
        const titleParents = $title.parents().toArray();
        const candidateParents = $candidate.parents().toArray();

        // Check if they share a close parent
        for (let i = 0; i < Math.min(2, titleParents.length); i++) {
          if (candidateParents.indexOf(titleParents[i]) >= 0) {
            totalBonus += 10;
            break;
          }
        }
      }
    }
  });

  return validCount > 0 ? totalBonus / validCount : 0;
}

/**
 * Phase 3: Check if a class token is stable (not hashed, not Tailwind utility, not generated)
 */
function isStableClassToken(token: string): boolean {
  if (!token || token.length === 0) return false;

  // Reject very long tokens (likely hashed)
  if (token.length > 40) return false;

  // Reject tokens with lots of digits/symbols (hashed or css-module)
  const digitSymbolRatio = (token.match(/[0-9_-]/g) || []).length / token.length;
  if (digitSymbolRatio > 0.4) return false;

  // Reject obvious Tailwind-like utilities (optional - can tune)
  const tailwindPatterns = /^(flex|grid|p-\d|m-\d|text-|bg-|border-|rounded-|shadow-|w-\d|h-\d)/;
  if (tailwindPatterns.test(token)) return false;

  // Reject tokens that look like CSS module hashes
  if (/^[a-z0-9]{8,}$/i.test(token)) return false;

  return true;
}

/**
 * Phase 3: Minimize selector to shortest stable form
 * Returns the shortest selector that matches the same elements across items
 */
function minimizeSelector(
  $: cheerio.Root,
  el: cheerio.Element,
  parentSelector: string,
  items: cheerio.Cheerio,
  field: string
): string {
  const $el = $(el);
  const tagName = el.type === "tag" ? el.tagName?.toLowerCase() : "*";
  if (!tagName) return "*";

  // Build candidate selectors (most stable first)
  const candidates: string[] = [];

  // 1. data-* attributes (most stable)
  const dataAttrs = Object.keys($el.attr() || {}).filter(k => k.startsWith('data-'));
  for (const attr of ['data-testid', 'data-qa', 'data-test', ...dataAttrs]) {
    const value = $el.attr(attr);
    if (value) {
      candidates.push(`[${attr}="${value}"]`);
    }
  }

  // 2. ID (if present and looks stable)
  const id = $el.attr('id');
  if (id && isStableClassToken(id)) {
    candidates.push(`#${id}`);
  }

  // 3. tag.stableClass (one stable class only)
  const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean);
  const stableClasses = classes.filter(isStableClassToken);
  if (stableClasses.length > 0) {
    // Try first stable class
    candidates.push(`${tagName}.${stableClasses[0]}`);
  }

  // 4. tag > tag.stableClass (max depth 3)
  const pathFromParent = $el.parentsUntil(parentSelector).toArray().reverse();
  if (pathFromParent.length > 0 && pathFromParent.length <= 3) {
    pathFromParent.push(el);
    const simplePath = pathFromParent
      .map((e) => {
        const t = e.type === "tag" ? e.tagName?.toLowerCase() : "*";
        const cls = ($(e).attr("class") || "").split(/\s+/).filter(isStableClassToken);
        return cls.length > 0 ? `${t}.${cls[0]}` : t;
      })
      .join(" > ");
    candidates.push(simplePath);
  }

  // 5. Simple tag
  candidates.push(tagName);

  // 6. nth-of-type fallback
  const siblings = $el.parent().children(tagName);
  const index = siblings.index(el);
  if (index >= 0) {
    candidates.push(`${tagName}:nth-of-type(${index + 1})`);
  }

  // Validate each candidate across sampled items
  const originalValue = extractValue(field, $el, $);

  for (const candidate of candidates) {
    let validCount = 0;
    let matchesTooMany = false;

    items.each((_, item) => {
      const $item = $(item);
      const matches = $item.find(candidate);

      // Check if matches at least one but not too many
      if (matches.length === 0) {
        return; // Skip this item if no match
      }
      if (matches.length > 3) {
        matchesTooMany = true;
        return false; // Break early
      }

      // Check if value matches
      const firstMatch = matches.first();
      const value = extractValue(field, firstMatch, $);

      if (value && value.length > 0) {
        validCount++;
      }
    });

    if (matchesTooMany) continue;

    // Accept if valid in >= 70% of items (adjusted per field)
    const coverageThreshold =
      field === "author" ? 0.2 :
      field === "date" ? 0.5 :
      0.7;

    if (validCount >= items.length * coverageThreshold) return candidate;
  }

  // Fallback: return full path with all classes (old behavior)
  const pathFromParent2 = $el.parentsUntil(parentSelector).toArray().reverse();
  pathFromParent2.push(el);
  return pathFromParent2
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

/**
 * Calculate the median value from an array of numbers
 */
function getMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

// scoreElementByField removed - replaced by Phase 2 per-item aggregate scoring

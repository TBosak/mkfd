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
  }
  
  export async function suggestSelectors(url: string): Promise<SuggestedSelectors> {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const fieldCandidates = {
      title: [
        'h1', 'h2', 'h3', 'header h1', 'header h2', 'header h3',
        '[class*="title"]', '[id*="title"]',
        '[class*="headline"]', '[id*="headline"]',
        '[class*="heading"]', '[id*="heading"]',
        '[class*="post-title"]', '[id*="post-title"]'
      ],
      description: [
        'p', 'article p', 'div p', 'section p',
        '[class*="desc"]', '[id*="desc"]',
        '[class*="summary"]', '[id*="summary"]',
        '[class*="body"]', '[id*="body"]',
        '[class*="content"]', '[id*="content"]',
        '[class*="teaser"]', '[id*="teaser"]'
      ],
      link: [
        'a',
        '[class*="link"]', '[id*="link"]',
        '[class*="url"]', '[id*="url"]',
        '[class*="href"]', '[id*="href"]'
      ],
      enclosure: [
        'img', 'video', 'audio',
        '[class*="media"]', '[id*="media"]',
        '[class*="thumbnail"]', '[id*="thumbnail"]',
        '[class*="image"]', '[id*="image"]',
        '[class*="photo"]', '[id*="photo"]',
        '[class*="video"]', '[id*="video"]',
        '[class*="audio"]', '[id*="audio"]'
      ],
      date: [
        'time', 'span', 'div',
        '[class*="date"]', '[id*="date"]',
        '[class*="time"]', '[id*="time"]',
        '[class*="published"]', '[id*="published"]',
        '[class*="updated"]', '[id*="updated"]',
        '[class*="timestamp"]', '[id*="timestamp"]'
      ],
      author: [
        '[class*="author"]', '[id*="author"]',
        '[class*="byline"]', '[id*="byline"]',
        '[class*="writer"]', '[id*="writer"]',
        '[class*="contributor"]', '[id*="contributor"]',
        '[class*="name"]', '[id*="name"]'
      ]
    };    
  
    const commonParents = findCommonParents($, Object.values(fieldCandidates));
  
    if (commonParents.length === 0) {
      throw new Error("No common repeating parent structures identified.");
    }
  
    const iteratorSelector = commonParents[0];
    const firstItem = $(iteratorSelector).first();

    const baseUrl = extractRootUrl(url);
    const childSelectors = suggestChildSelectors($, iteratorSelector, fieldCandidates, baseUrl);

    const rawDateText = $(iteratorSelector).find(childSelectors.date.selector).first().text().trim();
    const inferredDateFormat = detectDateFormat(rawDateText);

    const linkElem = firstItem.find(childSelectors.link.selector ?? '').first();
    const href = linkElem.attr('href');
    const isLinkRelative = isRelativeUrl(href);

    const enclosureElem = firstItem.find(childSelectors.enclosure.selector ?? '').first();
    const src = enclosureElem.attr('src');
    const isEnclosureRelative = isRelativeUrl(src);
    
    return {
      iterator: iteratorSelector,
      title: {
        selector: childSelectors.title.selector ?? "",
        stripHtml: true,
        titleCase: false
      },
      description: {
        selector: childSelectors.description.selector ?? "",
        stripHtml: true
      },
      link: {
        selector: childSelectors.link.selector ?? "",
        attribute: "href",
        relativeLink: isLinkRelative,
        rootUrl: isLinkRelative ? baseUrl : undefined
      },
      enclosure: {
        selector: childSelectors.enclosure.selector ?? "",
        attribute: "src",
        relativeLink: isEnclosureRelative,
        rootUrl: isEnclosureRelative ? baseUrl : undefined
      },
      date: {
        selector: childSelectors.date.selector ?? "",
        attribute: "",
        dateFormat: inferredDateFormat ?? undefined
      }
    };
  }
  
  function findCommonParents($: cheerio.Root, candidateGroups: string[][]): string[] {
    const candidateSelectors: string[] = [];
  
    // First, explicitly check for known good container elements like <article>
    const semanticTags = ['article', 'li', 'section', 'div'];
  
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
  
      flatSelectors.forEach(sel => {
        $(sel).each((_, el) => {
          const parent = $(el).parent();
          const tagName = parent.prop('tagName')?.toLowerCase() || '';
          const classList = (parent.attr('class') || '').trim().split(/\s+/).join('.');
          const parentSelector = `${tagName}${classList ? '.' + classList : ''}`;
          selectorCounts[parentSelector] = (selectorCounts[parentSelector] || 0) + 1;
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
    fieldCandidates: Record<string, string[]>,
    baseUrl: string
  ): Record<string, CSSTarget> {
    const results: Record<string, CSSTarget> = {};
  
    for (const field of Object.keys(fieldCandidates)) {
      let bestScore = -Infinity;
      let bestTarget: CSSTarget = new CSSTarget("");
  
      for (const candidate of fieldCandidates[field]) {
        const fullSelector = `${parentSelector} ${candidate}`.trim();
        $(fullSelector).each((_, el) => {
          const score = scoreElementByField(field, el, $);
          if (score > bestScore) {
            bestScore = score;
  
            const pathFromParent = $(el).parentsUntil(parentSelector).toArray().reverse();
            pathFromParent.push(el);
            const relSelector = pathFromParent.map(e => {
              const tag = e.type === "tag" ? e.tagName.toLowerCase() : '*';
              const classes = ($(e).attr("class") || "")
                .split(/\s+/)
                .filter(Boolean)
                .map(cls => `.${cls}`)
                .join('');
              return tag + classes;
            }).join(' > ');
  
            const attrValue = field === 'link' || field === 'enclosure'
              ? $(el).attr("href") || $(el).attr("src")
              : undefined;
  
            const attribute = attrValue
              ? Object.entries($(el).attr() || {}).find(([_, val]) => val === attrValue)?.[0]
              : undefined;
  
            const isRelative = attrValue && isRelativeUrl(attrValue);
            const resolvedBase = isRelative ? baseUrl : undefined;
  
            bestTarget = new CSSTarget(
              relSelector,
              attribute,
              false,
              resolvedBase,
              isRelative
            );
  
            if (field === 'date') {
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
      { regex: /^\d{4}[-/]\d{2}[-/]\d{2}/, format: 'YYYY-MM-DD' },           // 2025-04-03 or 2025/04/03
      { regex: /^\d{2}[-/]\d{2}[-/]\d{4}/, format: 'MM-DD-YYYY' },           // 04-03-2025 or 04/03/2025
      { regex: /^\d{2}[-/]\d{2}[-/]\d{2}/, format: 'MM-DD-YY' },             // 04-03-25
      { regex: /^\d{2}\.\d{2}\.\d{4}/, format: 'DD.MM.YYYY' },               // 03.04.2025
      { regex: /^\d{4}\.\d{2}\.\d{2}/, format: 'YYYY.MM.DD' },               // 2025.04.03
      { regex: /^\d{8}$/, format: 'YYYYMMDD' },                              // 20250403
      { regex: /^\d{1,2} [A-Za-z]+ \d{4}/, format: 'D MMMM YYYY' },          // 3 April 2025
      { regex: /^[A-Za-z]+ \d{1,2}, \d{4}/, format: 'MMMM D, YYYY' },        // April 3, 2025
      { regex: /^[A-Za-z]+ \d{4}/, format: 'MMMM YYYY' },                    // April 2025
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
    return value.startsWith('/') || !/^https?:\/\//i.test(value);
  }

  function extractRootUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.origin;
    } catch {
      return '';
    }
  }

  function scoreElementByField(field: string, el: cheerio.Element, $: cheerio.Root): number {
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
        const hasDateTokens = /\b\d{1,4}\b/.test(text) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text);
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
        break;
    }
  
    if (new Set(text.split(/\s+/)).size === words) score += 10;
    if (len < 5 || words < 2) score -= 30;
    if (len > 1000) score -= 30;
  
    return score;
  }
  
  function detectDates(text: string): string | undefined {
    const formats = [
      { regex: /\b\d{4}-\d{2}-\d{2}\b/, format: "YYYY-MM-DD" },
      { regex: /\b\d{2}\/\d{2}\/\d{4}\b/, format: "MM/DD/YYYY" },
      { regex: /\b\d{2}-\d{2}-\d{4}\b/, format: "MM-DD-YYYY" },
      { regex: /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}/i, format: "MMM D, YYYY" }
    ];
    for (const f of formats) {
      if (f.regex.test(text)) return f.format;
    }
    return undefined;
  }
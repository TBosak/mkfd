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
      title: ['h1', 'h2', 'h3', '[class*="title"]', '[id*="title"]'],
      description: ['p', '[class*="desc"]', '[class*="summary"]'],
      link: ['a[href^="http"]', 'a[href]'],
      enclosure: ['img[src]', 'video[src]', 'audio[src]'],
      date: ['time', '[class*="date"]', '[id*="date"]']
    };
  
    const commonParents = findCommonParents($, Object.values(fieldCandidates));
  
    if (commonParents.length === 0) {
      throw new Error("No common repeating parent structures identified.");
    }
  
    const iteratorSelector = commonParents[0];
    const firstItem = $(iteratorSelector).first();
    const childSelectors = suggestChildSelectors($, iteratorSelector, fieldCandidates);
    const rawDateText = $(iteratorSelector).find(childSelectors.date).first().text().trim();
    const inferredDateFormat = detectDateFormat(rawDateText);

    const linkElem = firstItem.find(childSelectors.link ?? '').first();
    const href = linkElem.attr('href');
    const isLinkRelative = isRelativeUrl(href);

    const enclosureElem = firstItem.find(childSelectors.enclosure ?? '').first();
    const src = enclosureElem.attr('src');
    const isEnclosureRelative = isRelativeUrl(src);
    
    const baseUrl = extractRootUrl(url);
    
    
    return {
      iterator: iteratorSelector,
      title: {
        selector: childSelectors.title ?? "",
        stripHtml: true,
        titleCase: false
      },
      description: {
        selector: childSelectors.description ?? "",
        stripHtml: true
      },
      link: {
        selector: childSelectors.link ?? "",
        attribute: "href",
        relativeLink: isLinkRelative,
        rootUrl: isLinkRelative ? baseUrl : undefined
      },
      enclosure: {
        selector: childSelectors.enclosure ?? "",
        attribute: "src",
        relativeLink: isEnclosureRelative,
        rootUrl: isEnclosureRelative ? baseUrl : undefined
      },
      date: {
        selector: childSelectors.date ?? "",
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
  
  export function suggestChildSelectors(
    $: cheerio.Root,
    parentSelector: string,
    candidates: Record<string, string[]>
  ): Record<string, string | null> {
    const selectors: Record<string, string | null> = {};
    const parentElems = $(parentSelector);
  
    for (const [field, candidateSelectors] of Object.entries(candidates)) {
      for (const candidate of candidateSelectors) {
        const allMatch = parentElems.toArray().every(el => $(el).find(candidate).length > 0);
        if (allMatch) {
          selectors[field] = candidate;
          break;
        }
      }
  
      if (!selectors[field]) selectors[field] = null;
    }
  
    return selectors;
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
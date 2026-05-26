import * as cheerio from "cheerio";

export function extractJsonLd(html: string): unknown[] {
  const $ = cheerio.load(html);
  const nodes: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) nodes.push(...parsed);
      else if (parsed?.["@graph"] && Array.isArray(parsed["@graph"])) nodes.push(...parsed["@graph"]);
      else nodes.push(parsed);
    } catch {
      // Invalid embedded JSON-LD should not fail page analysis.
    }
  });
  return nodes;
}

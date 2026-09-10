import * as cheerio from "cheerio";
import {
  assertParserInputWithinLimit,
  inputFitsByteLimit,
  PARSER_INPUT_LIMITS,
} from "./parser-input-limits.utility";

export function extractJsonLd(html: string): unknown[] {
  assertParserInputWithinLimit(html, "json-ld-html");
  const $ = cheerio.load(html);
  const nodes: unknown[] = [];
  let attemptedBlocks = 0;
  $("script[type='application/ld+json']").each((_, el) => {
    if (attemptedBlocks >= PARSER_INPUT_LIMITS.jsonLdBlocks) return false;
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    if (!inputFitsByteLimit(raw, PARSER_INPUT_LIMITS.jsonLdBlockBytes)) return;
    attemptedBlocks += 1;
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

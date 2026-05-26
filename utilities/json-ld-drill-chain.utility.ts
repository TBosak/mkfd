import * as cheerio from "cheerio";
import { getGlobalFetchPolicyOptions, type OutboundFetchPolicyOptions } from "./outbound-fetch-policy.utility";
import { axiosGetWithPolicyRedirects } from "./feed-config-route-adapter.utility";
import { extractJsonLd } from "./json-ld.utility";
import { analyzeJsonLd } from "./json-ld-analysis.utility";
import type { JsonLdDrillChainCandidate } from "../models/source-assistant.model";

const MAX_LINKS = 5;
const CANDIDATE_SELECTORS = ["article a[href]", ".post a[href]", ".entry a[href]", ".card a[href]", "main a[href]"];

export async function analyzeJsonLdDrillChain(
  html: string,
  pageUrl: string,
  policyOptions: OutboundFetchPolicyOptions = getGlobalFetchPolicyOptions(),
): Promise<JsonLdDrillChainCandidate[]> {
  const $ = cheerio.load(html);
  const candidates: JsonLdDrillChainCandidate[] = [];

  for (const selector of CANDIDATE_SELECTORS) {
    const sampleUrls = [...new Set($(selector).toArray()
      .map((el) => $(el).attr("href"))
      .filter(Boolean)
      .map((href) => new URL(href!, pageUrl).toString())
      .filter((url) => new URL(url).origin === new URL(pageUrl).origin))]
      .slice(0, MAX_LINKS);

    if (sampleUrls.length < 2) continue;

    let itemLikePages = 0;
    for (const url of sampleUrls) {
      try {
        const response = await axiosGetWithPolicyRedirects(url, { timeout: 6000, responseType: "text" }, policyOptions);
        const analysis = analyzeJsonLd(extractJsonLd(String(response.data ?? "")));
        if (analysis.itemLikeCount > 0) itemLikePages++;
      } catch {
        // Detail pages are sampled opportunistically; failed samples lower confidence.
      }
    }

    if (itemLikePages > 0) {
      candidates.push({
        selector,
        sampleUrls,
        jsonLdCoverage: itemLikePages / sampleUrls.length,
        itemLikeCount: itemLikePages,
        warnings: [],
      });
    }
  }

  return candidates.sort((a, b) => b.jsonLdCoverage - a.jsonLdCoverage);
}

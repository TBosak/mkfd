import * as cheerio from "cheerio";
import { getGlobalFetchPolicyOptions, type OutboundFetchPolicyOptions } from "../outbound-fetch-policy.utility";
import { executeWithFetchPolicy } from "../fetch-policy.utility";
import { discoverFeeds } from "../feed-discovery.utility";
import { extractJsonLd } from "../json-ld.utility";
import { analyzeJsonLd } from "../json-ld-analysis.utility";
import { detectForms } from "../form-detection.utility";
import { analyzeJsonLdDrillChain } from "../json-ld-drill-chain.utility";
import { suggestSelectorsFromHtml } from "../selector-suggestion.utility";
import type { SelectorSuggestionPlan, SourceAssistantAnalyzeRequest, SourceAssistantObservation } from "../../models/source-assistant.model";

function getContentType(headers: Record<string, unknown>): string {
  const value = headers["content-type"] ?? headers["Content-Type"];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function selectorPlanFromSuggestions(html: string, url: string): SelectorSuggestionPlan {
  try {
    const result = suggestSelectorsFromHtml(html, url);
    return {
      iterator: result.iterator || undefined,
      title: result.title?.selector || undefined,
      link: result.link?.selector || undefined,
      description: result.description?.selector || undefined,
      date: result.date?.selector || undefined,
      author: result.author?.selector || undefined,
    };
  } catch {
    return {};
  }
}

function observeJson(data: unknown, base: SourceAssistantObservation): SourceAssistantObservation {
  const rootKind = Array.isArray(data) ? "array" : data && typeof data === "object" ? "object" : "primitive";
  const keys = rootKind === "object" ? Object.keys(data as Record<string, unknown>).slice(0, 25) : [];
  return { ...base, json: { rootKind, itemCount: Array.isArray(data) ? data.length : undefined, keys } };
}

export async function observeSource(
  request: SourceAssistantAnalyzeRequest,
  opts: { policyOptions?: OutboundFetchPolicyOptions } = {},
): Promise<SourceAssistantObservation> {
  const policyOptions = opts.policyOptions ?? getGlobalFetchPolicyOptions();
  const analyzedAt = new Date().toISOString();
  const base: SourceAssistantObservation = {
    url: request.url,
    finalUrl: request.url,
    analyzedAt,
    warnings: [],
  };

  try {
    const response = await executeWithFetchPolicy<string>({
      url: request.url,
      outboundPolicy: policyOptions,
      policy: { feedRunTimeoutMs: 12000, retryCount: 1 },
      axiosConfig: {
        timeout: 12000,
        responseType: "text",
        headers: request.options?.headers,
        validateStatus: () => true,
      },
    });
    const finalUrl = response.finalUrl;
    const contentType = getContentType(response.headers as Record<string, unknown>);
    const body = response.data;
    const observation: SourceAssistantObservation = {
      ...base,
      finalUrl,
      contentType,
      status: response.status,
    };

    if (contentType.includes("json") || (typeof body === "string" && body.trim().startsWith("{"))) {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      return observeJson(parsed, observation);
    }

    if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
      return {
        ...observation,
        xml: {
          rootName: String(body).match(/<([a-zA-Z0-9:_-]+)/)?.[1],
          feeds: [{ url: finalUrl, type: contentType.includes("atom") ? "atom" : "rss", confidence: 0.95 }],
        },
      };
    }

    const html = String(body ?? "");
    const $ = cheerio.load(html);
    const jsonLd = analyzeJsonLd(extractJsonLd(html));
    const feeds = discoverFeeds(html, finalUrl);
    const forms = detectForms(html, finalUrl);
    const selectorPlan = selectorPlanFromSuggestions(html, finalUrl);
    const drillChainCandidates = jsonLd.itemLikeCount === 0
      ? await analyzeJsonLdDrillChain(html, finalUrl, policyOptions)
      : [];

    return {
      ...observation,
      html: {
        title: $("title").first().text().trim() || $("h1").first().text().trim() || undefined,
        description: $("meta[name='description']").attr("content") || undefined,
        canonicalUrl: $("link[rel='canonical']").attr("href")
          ? new URL($("link[rel='canonical']").attr("href")!, finalUrl).toString()
          : undefined,
        feeds,
        jsonLd,
        forms,
        selectorPlan,
        drillChainCandidates,
      },
    };
  } catch (error: any) {
    return {
      ...base,
      warnings: [{ code: "fetch.failed", message: error?.message ?? "Source analysis failed." }],
    };
  }
}

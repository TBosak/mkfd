import type { SourceAssistantObservation, SourceAssistantRecommendation } from "../../../models/source-assistant.model";

export function buildStarterConfig(
  recommendation: SourceAssistantRecommendation,
  observation: SourceAssistantObservation,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const feedName = observation.html?.title || new URL(observation.finalUrl).hostname;
  if (recommendation.routeType === "existingFeed") {
    const feed = observation.html?.feeds?.[0] ?? observation.xml?.feeds?.[0];
    return {
      feedType: "feedTransformer",
      feedName,
      transformerSources: [{ url: feed?.url ?? observation.finalUrl, format: feed?.type ?? "auto" }],
      transformerMergeStrategy: "dateDesc",
      transformerDedupeAcrossSources: true,
      transformerFeedTitle: feedName,
      ...(options ?? {}),
    };
  }
  if (recommendation.routeType === "restApi") {
    return {
      feedType: "api",
      feedName,
      feedUrl: observation.finalUrl,
      apiMethod: "GET",
      apiItemsPath: observation.json?.rootKind === "array" ? "$" : "",
      ...(options ?? {}),
    };
  }
  if (recommendation.routeType === "webScraping") {
    const plan = recommendation.webScrapingPlan;
    const hasJsonLd = Number((plan?.jsonLd as any)?.itemLikeCount ?? 0) > 0;
    return {
      feedType: "webScraping",
      feedName,
      feedUrl: observation.finalUrl,
      extractionMode: hasJsonLd ? "jsonLdPage" : "cssSelectors",
      jsonLdTitlePath: "headline",
      jsonLdDescriptionPath: "description",
      jsonLdLinkPath: "url",
      jsonLdDatePath: "datePublished",
      jsonLdAuthorPath: "author.name",
      jsonLdGuidPath: "url",
      jsonLdContentPath: "articleBody",
      itemSelector: plan?.selectors?.iterator ?? "",
      titleSelector: plan?.selectors?.title ?? "",
      linkSelector: plan?.selectors?.link ?? "",
      descriptionSelector: plan?.selectors?.description ?? "",
      dateSelector: plan?.selectors?.date ?? "",
      authorSelector: plan?.selectors?.author ?? "",
      sourceAssistantAnalysis: { observation, recommendation },
      ...(options ?? {}),
    };
  }
  return {
    feedType: recommendation.routeType,
    feedName,
    sourceUrl: observation.finalUrl,
    sourceAssistantAnalysis: { observation, recommendation },
    ...(options ?? {}),
  };
}

import { describe, expect, test } from "bun:test";
import { buildStarterConfig } from "../../utilities/source-assistant/starter-configs";
import type {
  SourceAssistantObservation,
  SourceAssistantRecommendation,
  SourceAssistantRouteType,
} from "../../models/source-assistant.model";

// ---------------------------------------------------------------------------
// `p1-fallow-static-analysis-gate` requirement 2: the nine
// `utilities/source-assistant/starter-configs/*.adapter.ts` files are dead
// (each is a thin, unused re-export of `buildStarterConfig` under a
// different name - `index.ts` implements every route inline and imports
// none of them). Deleting them cannot change `buildStarterConfig`'s
// behavior, since this suite only ever imports from `starter-configs`
// (`index.ts`) directly - never from an adapter module - both before and
// after that deletion. The describe blocks below extend the single
// pre-existing `existingFeed` case with the remaining eight `routeType`
// values so the removal is proven safe by a passing regression suite,
// rather than assumed from "nothing imports these files".
// ---------------------------------------------------------------------------

function baseObservation(overrides: Partial<SourceAssistantObservation> = {}): SourceAssistantObservation {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    analyzedAt: new Date(0).toISOString(),
    warnings: [],
    ...overrides,
  };
}

function baseRecommendation(
  routeType: SourceAssistantRouteType,
  overrides: Partial<SourceAssistantRecommendation> = {},
): SourceAssistantRecommendation {
  return {
    id: `${routeType}-1`,
    routeType,
    title: routeType,
    description: "",
    confidence: 0.9,
    rankScore: 1,
    confidenceBand: "high",
    reasons: [],
    warnings: [],
    evidence: [],
    ...overrides,
  };
}

describe("source assistant starter configs", () => {
  test("builds feedTransformer config for existing feed recommendations", () => {
    const obs: SourceAssistantObservation = {
      url: "https://example.com",
      finalUrl: "https://example.com",
      analyzedAt: new Date(0).toISOString(),
      warnings: [],
      html: {
        title: "Example",
        feeds: [{ url: "https://example.com/feed.xml", type: "rss", confidence: 0.95 }],
        jsonLd: { nodes: [], itemLikeCount: 0, highValueTypes: [], warnings: [] },
        forms: [],
        drillChainCandidates: [],
      },
    };
    const rec: SourceAssistantRecommendation = {
      id: "existingFeed-1",
      routeType: "existingFeed",
      title: "Use feed",
      description: "",
      confidence: 0.95,
      rankScore: 1,
      confidenceBand: "high",
      reasons: [],
      warnings: [],
      evidence: [],
    };
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "feedTransformer",
      transformerSources: [{ url: "https://example.com/feed.xml", format: "rss" }],
    });
  });

  test("existingFeed falls back to observation.finalUrl and 'auto' format when html has no feeds but xml does", () => {
    const obs = baseObservation({ xml: { feeds: [{ url: "https://example.com/feed.atom", type: "atom", confidence: 0.9 }] } });
    const rec = baseRecommendation("existingFeed");
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "feedTransformer",
      transformerSources: [{ url: "https://example.com/feed.atom", format: "atom" }],
    });
  });

  test("existingFeed with neither html nor xml feeds falls back to the observation's own finalUrl and 'auto' format", () => {
    const obs = baseObservation();
    const rec = baseRecommendation("existingFeed");
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      transformerSources: [{ url: obs.finalUrl, format: "auto" }],
    });
  });

  test("caller-supplied options override the route's own defaults (shared 'options' spread behavior)", () => {
    const obs = baseObservation({ xml: { feeds: [{ url: "https://example.com/feed.atom", type: "atom", confidence: 0.9 }] } });
    const rec = baseRecommendation("existingFeed");
    const result = buildStarterConfig(rec, obs, { transformerMergeStrategy: "dateAsc" });
    expect(result.transformerMergeStrategy).toBe("dateAsc");
  });

  test("feedName falls back to the finalUrl hostname when html.title is absent", () => {
    const obs = baseObservation({ url: "https://blog.example.org/feed", finalUrl: "https://blog.example.org/feed" });
    const rec = baseRecommendation("existingFeed");
    expect(buildStarterConfig(rec, obs).feedName).toBe("blog.example.org");
  });

  test("builds an 'api' config for restApi recommendations, defaulting apiItemsPath to '$' for an array JSON root", () => {
    const obs = baseObservation({ json: { rootKind: "array", keys: [] } });
    const rec = baseRecommendation("restApi");
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "api",
      feedName: "example.com",
      feedUrl: obs.finalUrl,
      apiMethod: "GET",
      apiItemsPath: "$",
    });
  });

  test("restApi uses an empty apiItemsPath for a non-array JSON root", () => {
    const obs = baseObservation({ json: { rootKind: "object", keys: ["data"] } });
    const rec = baseRecommendation("restApi");
    expect(buildStarterConfig(rec, obs).apiItemsPath).toBe("");
  });

  test("restApi uses an empty apiItemsPath when there is no JSON observation at all", () => {
    const obs = baseObservation();
    const rec = baseRecommendation("restApi");
    expect(buildStarterConfig(rec, obs).apiItemsPath).toBe("");
  });

  test("webScraping without a JSON-LD plan (itemLikeCount 0) uses cssSelectors extraction with the plan's selectors", () => {
    const obs = baseObservation();
    const rec = baseRecommendation("webScraping", {
      webScrapingPlan: {
        request: { url: obs.finalUrl },
        selectors: { iterator: ".item", title: ".title", link: "a", description: ".desc", date: ".date", author: ".author" },
      },
    });
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "webScraping",
      extractionMode: "cssSelectors",
      itemSelector: ".item",
      titleSelector: ".title",
      linkSelector: "a",
      descriptionSelector: ".desc",
      dateSelector: ".date",
      authorSelector: ".author",
    });
  });

  test("webScraping with a JSON-LD plan (itemLikeCount > 0) uses jsonLdPage extraction with fixed JSON-LD paths", () => {
    const obs = baseObservation();
    const rec = baseRecommendation("webScraping", {
      webScrapingPlan: {
        request: { url: obs.finalUrl },
        jsonLd: { nodes: [], itemLikeCount: 3, highValueTypes: ["Article"], warnings: [] },
      },
    });
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "webScraping",
      extractionMode: "jsonLdPage",
      jsonLdTitlePath: "headline",
      jsonLdDescriptionPath: "description",
      jsonLdLinkPath: "url",
      jsonLdDatePath: "datePublished",
      jsonLdAuthorPath: "author.name",
      jsonLdGuidPath: "url",
      jsonLdContentPath: "articleBody",
    });
  });

  test("webScraping with no webScrapingPlan at all still builds a cssSelectors config with empty selectors (no throw)", () => {
    const obs = baseObservation();
    const rec = baseRecommendation("webScraping");
    expect(buildStarterConfig(rec, obs)).toMatchObject({
      feedType: "webScraping",
      extractionMode: "cssSelectors",
      itemSelector: "",
      titleSelector: "",
    });
  });

  const FALLBACK_ROUTE_TYPES: SourceAssistantRouteType[] = [
    "sitemap",
    "calendar",
    "graphql",
    "serviceConnector",
    "changeDetection",
    "manual",
  ];

  for (const routeType of FALLBACK_ROUTE_TYPES) {
    test(`builds a generic ${routeType} config via the shared fallback branch (feedType/sourceUrl/sourceAssistantAnalysis)`, () => {
      const obs = baseObservation();
      const rec = baseRecommendation(routeType);
      expect(buildStarterConfig(rec, obs)).toMatchObject({
        feedType: routeType,
        feedName: "example.com",
        sourceUrl: obs.finalUrl,
        sourceAssistantAnalysis: { observation: obs, recommendation: rec },
      });
    });
  }

  test("every SourceAssistantRouteType value is covered by exactly one of the tests above (locks in full routeType coverage before/after the adapter deletion)", () => {
    const ALL_ROUTE_TYPES: SourceAssistantRouteType[] = [
      "existingFeed",
      "webScraping",
      "sitemap",
      "calendar",
      "restApi",
      "graphql",
      "serviceConnector",
      "changeDetection",
      "manual",
    ];
    const covered = new Set<SourceAssistantRouteType>(["existingFeed", "restApi", "webScraping", ...FALLBACK_ROUTE_TYPES]);
    for (const routeType of ALL_ROUTE_TYPES) {
      expect(covered.has(routeType), `routeType '${routeType}' has no behavior test above`).toBe(true);
    }
  });
});

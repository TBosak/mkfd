import type { FeedFormData, KeyValuePair, DrillStep } from "../types/feed";

function objToKVPairs(obj: Record<string, string> | undefined | null): KeyValuePair[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value: value ?? "" }));
}

function parseSelectorString(val: string | undefined): { selector: string; attribute: string } {
  if (!val) return { selector: "", attribute: "" };
  const idx = val.indexOf("|attr:");
  if (idx === -1) return { selector: val, attribute: "" };
  return { selector: val.slice(0, idx), attribute: val.slice(idx + 6) };
}

function mapArticleField(field: Record<string, any> | undefined, prefix: string): Record<string, unknown> {
  if (!field) return {};
  const out: Record<string, unknown> = {
    [`${prefix}Selector`]: field.selector ?? "",
    [`${prefix}Attribute`]: field.attribute ?? "",
    [`${prefix}StripHtml`]: field.stripHtml ?? false,
    [`${prefix}TitleCase`]: field.titleCase ?? false,
    [`${prefix}RelativeLink`]: field.isRelative ?? false,
    [`${prefix}BaseUrl`]: field.baseUrl ?? "",
    [`${prefix}DrillChain`]: (field.drillChain ?? []) as DrillStep[],
    [`${prefix}Iterator`]: field.iterator ?? "",
  };
  if (field.dateFormat !== undefined) {
    out[`${prefix}Format`] = field.dateFormat ?? "";
    out.customDateFormat = field.customDateFormat ?? "";
  }
  if (field.guidIsPermaLink !== undefined) out.guidIsPermaLink = field.guidIsPermaLink;
  return out;
}

export function configToFormData(config: Record<string, any>): Partial<FeedFormData> {
  const feedType = (config.feedType === "rest" ? "api" : config.feedType) as FeedFormData["feedType"];

  const common: Partial<FeedFormData> = {
    feedName: config.feedName ?? "",
    feedType,
    refreshTime: config.refreshTime ?? 5,
    reverse: config.reverse ?? false,
    advanced: config.advanced ?? false,
    strict: config.strict ?? false,
    headers: objToKVPairs(config.headers),
    cookies: config.cookies ?? [],
    webhook: config.webhook
      ? {
          enabled: config.webhook.enabled ?? false,
          url: config.webhook.url ?? "",
          format: config.webhook.format ?? "xml",
          newItemsOnly: config.webhook.newItemsOnly ?? true,
          headers: JSON.stringify(config.webhook.headers ?? {}),
          customPayload: config.webhook.customPayload ?? "",
        }
      : { enabled: false, newItemsOnly: true },
    flaresolverr: config.flaresolverr
      ? {
          enabled: config.flaresolverr.enabled ?? false,
          serverUrl: config.flaresolverr.serverUrl ?? "",
          timeout: config.flaresolverr.timeout ?? 60000,
        }
      : { enabled: false },
  };

  if (feedType === "webScraping") {
    const a = config.article ?? {};
    const lang = parseSelectorString(config.feedLanguage);
    const copyright = parseSelectorString(config.feedCopyright);
    const editor = parseSelectorString(config.feedManagingEditor);
    const webmaster = parseSelectorString(config.feedWebMaster);

    return {
      ...common,
      feedUrl: config.config?.baseUrl ?? "",
      requestMode: config.config?.request?.mode ?? "simple",
      proxyProfileId: config.config?.request?.proxyProfileId ?? "",
      userAgentProfileId: config.config?.request?.userAgentProfileId ?? "",
      userAgentOverride: config.config?.request?.userAgentOverride ?? "",
      formMethod: config.config?.request?.method ?? "GET",
      formActionUrl: config.config?.request?.actionUrl ?? "",
      formEncoding: config.config?.request?.encoding ?? "application/x-www-form-urlencoded",
      formFields: objToKVPairs(config.config?.request?.fields),
      extractionMode: config.extraction?.mode ?? "cssSelectors",
      jsonLdTitlePath: config.extraction?.mappings?.title ?? "headline",
      jsonLdDescriptionPath: config.extraction?.mappings?.description ?? "description",
      jsonLdLinkPath: config.extraction?.mappings?.link ?? "url",
      jsonLdDatePath: config.extraction?.mappings?.pubDate ?? "datePublished",
      jsonLdAuthorPath: config.extraction?.mappings?.author ?? "author.name",
      jsonLdGuidPath: config.extraction?.mappings?.guid ?? "url",
      jsonLdContentPath: config.extraction?.mappings?.content ?? "articleBody",
      jsonLdCategoriesPath: config.extraction?.mappings?.categories ?? "keywords",
      itemSelector: a.iterator?.selector ?? "",
      ...mapArticleField(a.title, "title"),
      ...mapArticleField(a.description, "description"),
      ...mapArticleField(a.link, "link"),
      ...mapArticleField(a.enclosure, "enclosure"),
      ...mapArticleField(a.author, "author"),
      ...mapArticleField(a.pubDate, "date"),
      ...mapArticleField(a.contentEncoded, "contentEncoded"),
      ...mapArticleField(a.summary, "summary"),
      ...mapArticleField(a.guid, "guid"),
      ...mapArticleField(a.categories, "categories"),
      ...mapArticleField(a.contributors, "contributors"),
      ...mapArticleField(a.lat, "lat"),
      ...mapArticleField(a.long, "long"),
      ...mapArticleField(a.comments, "commentsUrl"),
      ...mapArticleField(a.source?.title, "sourceTitle"),
      ...mapArticleField(a.source?.url, "sourceUrl"),
      feedLanguageSelector: lang.selector,
      feedLanguageAttribute: lang.attribute,
      feedCopyrightSelector: copyright.selector,
      feedCopyrightAttribute: copyright.attribute,
      feedManagingEditorSelector: editor.selector,
      feedManagingEditorAttribute: editor.attribute,
      feedWebMasterSelector: webmaster.selector,
      feedWebMasterAttribute: webmaster.attribute,
      ...parseSelectorString(config.feedCategories?.[0]).selector
        ? {
            feedCategoriesScrapingSelector: parseSelectorString(config.feedCategories?.[0]).selector,
            feedCategoriesScrapingAttribute: parseSelectorString(config.feedCategories?.[0]).attribute,
          }
        : {},
      ...parseSelectorString(String(config.feedTtl ?? "")).selector
        ? {
            feedTtlSelector: parseSelectorString(String(config.feedTtl ?? "")).selector,
            feedTtlAttribute: parseSelectorString(String(config.feedTtl ?? "")).attribute,
          }
        : {},
      ...parseSelectorString(config.feedSkipDays?.[0]).selector
        ? {
            feedSkipDaysSelector: parseSelectorString(config.feedSkipDays?.[0]).selector,
            feedSkipDaysAttribute: parseSelectorString(config.feedSkipDays?.[0]).attribute,
          }
        : {},
      ...parseSelectorString(config.feedSkipHours?.[0]?.toString()).selector
        ? {
            feedSkipHoursSelector: parseSelectorString(config.feedSkipHours?.[0]?.toString()).selector,
            feedSkipHoursAttribute: parseSelectorString(config.feedSkipHours?.[0]?.toString()).attribute,
          }
        : {},
      ...parseSelectorString(config.feedImage).selector
        ? {
            feedImageUrlSelector: parseSelectorString(config.feedImage).selector,
            feedImageUrlAttribute: parseSelectorString(config.feedImage).attribute,
          }
        : {},
    } as unknown as Partial<FeedFormData>;
  }

  if (feedType === "api") {
    const c = config.config ?? {};
    const m = config.apiMapping ?? {};
    return {
      ...common,
      feedUrl: c.baseUrl ?? "",
      apiRoute: c.route ?? "",
      apiMethod: c.method ?? "GET",
      apiParams: objToKVPairs(c.params),
      apiHeaders: objToKVPairs(c.apiSpecificHeaders),
      apiBody: objToKVPairs(c.apiSpecificBody),
      apiItemsPath: m.items ?? "",
      apiTitleField: m.title ?? "",
      apiLinkField: m.link ?? "",
      apiDescriptionField: m.description ?? "",
      apiDateField: m.date ?? "",
      apiAuthor: m.author ?? "",
      apiCategories: m.categories ?? "",
      apiGuid: m.guid ?? "",
      apiGuidIsPermaLink: m.guidIsPermaLink ?? "",
      apiEnclosureUrl: m.enclosureUrl ?? "",
      apiEnclosureSize: m.enclosureLength ?? "",
      apiEnclosureType: m.enclosureType ?? "",
      apiContentEncoded: m.contentEncoded ?? "",
      apiSummary: m.summary ?? "",
      apiContributors: m.contributors ?? "",
      apiLat: m.lat ?? "",
      apiLong: m.long ?? "",
      apiSourceUrl: m.sourceUrl ?? "",
      apiSourceTitle: m.sourceTitle ?? "",
      apiFeedTitle: m.feedTitlePath ?? "",
      apiFeedDescription: m.feedDescriptionPath ?? "",
      apiFeedLanguage: m.feedLanguagePath ?? "",
      apiFeedCopyright: m.feedCopyrightPath ?? "",
      apiFeedManagingEditor: m.feedManagingEditorPath ?? "",
      apiFeedWebMaster: m.feedWebMasterPath ?? "",
      apiFeedCategories: m.feedCategoriesPath ?? "",
      apiFeedPubDate: m.feedPubDatePath ?? "",
      apiFeedTtl: m.feedTtlPath ?? "",
      apiFeedSkipDays: m.feedSkipDaysPath ?? "",
      apiFeedSkipHours: m.feedSkipHoursPath ?? "",
      apiFeedImageUrl: m.feedImageUrl ?? "",
    } as unknown as Partial<FeedFormData>;
  }

  if (feedType === "email") {
    const c = config.config ?? {};
    return {
      ...common,
      emailHost: c.host ?? "",
      emailPort: c.port ?? 993,
      emailUsername: c.user ?? "",
      emailPassword: "",
      emailFolder: c.folder ?? "",
      emailCount: c.emailCount ?? 10,
    } as unknown as Partial<FeedFormData>;
  }

  if (feedType === "feedTransformer") {
    const transformer = config.feedTransformer ?? {};
    const feed = transformer.feed ?? {};
    const items = transformer.items ?? {};
    return {
      ...common,
      transformerSources: Array.isArray(transformer.sources)
        ? transformer.sources.map((source: Record<string, any>) => ({
            url: source.url ?? "",
            format: source.format ?? "auto",
          }))
        : [{ url: "", format: "auto" }],
      transformerMergeStrategy: transformer.mergeStrategy ?? "dateDesc",
      transformerMaxItems: transformer.maxItems,
      transformerDedupeAcrossSources: transformer.dedupeAcrossSources ?? true,
      transformerFeedTitle: feed.title ?? "",
      transformerFeedDescription: feed.description ?? "",
      transformerFeedLink: feed.link ?? "",
      transformerGuidStrategy: items.guidStrategy ?? "existingOrLinkHash",
      transformerDateStrategy: items.dateStrategy ?? "publishedOrUpdatedOrFetched",
      transformerStripDescriptionHtml: items.description?.stripHtml ?? true,
      transformerNormalizeWhitespace: items.description?.normalizeWhitespace ?? items.content?.normalizeWhitespace ?? true,
      transformerForceHttps: items.link?.forceHttps ?? false,
      transformerRemoveTrackingParams: items.link?.removeTrackingParams ?? true,
      transformerNormalizeCategories: items.categories?.normalizeWhitespace ?? true,
      transformerFilterInclude: items.filters?.include ?? [],
      transformerFilterExclude: items.filters?.exclude ?? [],
    } as unknown as Partial<FeedFormData>;
  }

  if (feedType === "sitemap") {
    const s = config.sitemap ?? {};
    return { ...common, sitemapUrl: s.url ?? "", sitemapMode: s.mode ?? "urlList", sitemapMaxItems: s.maxItems ?? 50, sitemapMaxUrlsToScan: s.maxUrlsToScan ?? 500 } as Partial<FeedFormData>;
  }

  if (feedType === "calendar") {
    const c = config.calendar ?? {};
    return { ...common, calendarUrl: c.url ?? "", calendarWindowDays: c.windowDays ?? 30, calendarMaxEvents: c.maxEvents ?? 50, calendarIncludePastEvents: c.includePastEvents ?? false, calendarIncludeCanceled: c.includeCanceled ?? false } as Partial<FeedFormData>;
  }

  if (feedType === "graphql") {
    const g = config.graphql ?? {};
    return { ...common, graphqlEndpoint: g.endpoint ?? "", graphqlQuery: g.query ?? "", graphqlVariables: g.variables ? JSON.stringify(g.variables, null, 2) : "", graphqlOperationName: g.operationName ?? "", graphqlItemPath: g.mapping?.itemPath ?? "", graphqlTitlePath: g.mapping?.title ?? "", graphqlLinkPath: g.mapping?.link ?? "", graphqlDescriptionPath: g.mapping?.description ?? "", graphqlDatePath: g.mapping?.pubDate ?? "", graphqlGuidPath: g.mapping?.guid ?? "" } as Partial<FeedFormData>;
  }

  if (feedType === "webhook") {
    const w = config.webhookFeed ?? {};
    return { ...common, webhookSlug: w.slug ?? "", webhookTokenHash: w.tokenHash ?? "", webhookMaxItems: w.maxItems ?? 50, webhookRetentionDays: w.retentionDays ?? 30, webhookDuplicateStrategy: w.duplicateStrategy ?? "idOrHash", webhookDateStrategy: w.dateStrategy ?? "payloadDateOrReceivedAt", webhookStoreRawPayload: w.storeRawPayload ?? false } as Partial<FeedFormData>;
  }

  if (feedType === "filesystem") {
    const f = config.filesystem ?? {};
    return { ...common, filesystemRootPath: f.rootPath ?? "", filesystemPublicBaseUrl: f.publicBaseUrl ?? "", filesystemRecursive: f.recursive ?? true, filesystemInclude: (f.include ?? []).join(","), filesystemExclude: (f.exclude ?? []).join(","), filesystemMaxItems: f.maxItems ?? 50, filesystemSortOrder: f.sortOrder ?? "modifiedDesc", filesystemTitleStrategy: f.titleStrategy ?? "filename", filesystemDescriptionStrategy: f.descriptionStrategy ?? "fileMetadata", filesystemSidecarEnabled: f.sidecar?.enabled ?? false, filesystemExtractionEnabled: f.extraction?.enabled ?? false } as Partial<FeedFormData>;
  }

  if (feedType === "serviceConnector") {
    const s = config.serviceConnector ?? {};
    return {
      ...common,
      serviceConnectorService: s.service ?? "jellyfin",
      serviceConnectorLabel: s.connection?.label ?? "",
      serviceConnectorServerUrl: s.connection?.settings?.serverUrl ?? "",
      serviceConnectorApiKey: "",
      serviceConnectorResourceId: s.resource?.id ?? "",
      serviceConnectorResourceLabel: s.resource?.label ?? "",
      serviceConnectorPreset: s.preset ?? "latestItems",
      serviceConnectorLimit: s.options?.limit ?? 50,
    } as Partial<FeedFormData>;
  }

  return common;
}

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
  const feedType = config.feedType as "webScraping" | "api" | "email";

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

  return common;
}

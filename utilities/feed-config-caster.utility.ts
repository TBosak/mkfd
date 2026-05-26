import { v4 as uuidv4 } from "uuid";
import { isProtectedValue, protectValue } from "./protected-values.utility";
import type { ProtectedRecord } from "../models/protected-value.model";
import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, EmailFeedConfig, FeedTransformerFeedConfig, SitemapFeedConfig, CalendarFeedConfig, GraphQLFeedConfig, FilesystemFeedConfig, WebhookFeedConfig, ServiceConnectorFeedConfig } from "../models/feed-config.model";
import { generateWebhookToken, hashWebhookToken } from "./webhook-feed.utility";
import { defaultFeedRssMetadata } from "../models/feed-config.model";
import CSSTarget from "../models/csstarget.model";

// Accepts the flat FeedFormData shape from the frontend without importing the frontend type.
// All field reads use optional chaining so missing fields degrade gracefully.
type FormInput = Record<string, unknown>;

export type CastContext = {
  feedId?: string;
  encryptionKey: string;
};

// Encrypt any { type: "protected", value: "not-asterisks" } values in a record
function encryptPendingProtectedValues(
  record: Record<string, unknown>,
  key: string,
): ProtectedRecord {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => {
      if (isProtectedValue(v) && v.type === "protected" && v.value !== "********") {
        return [k, protectValue(v.value, key)];
      }
      return [k, v];
    }),
  );
}

function kvPairsToRecord(pairs: unknown): Record<string, string> {
  if (!Array.isArray(pairs)) return {};
  return Object.fromEntries(
    (pairs as Array<{ key: string; value: string }>)
      .filter((p) => p.key?.trim())
      .map((p) => [p.key.trim(), p.value ?? ""])
  );
}

function buildCSSTargetFromForm(
  prefix: string,
  data: Record<string, unknown>,
): CSSTarget | undefined {
  const selector = data[`${prefix}Selector`] as string | undefined;
  if (!selector) return undefined;
  return new CSSTarget(
    selector,
    data[`${prefix}Attribute`] as string | undefined,
    data[`${prefix}StripHtml`] as boolean | undefined,
    data[`${prefix}BaseUrl`] as string | undefined,
    data[`${prefix}RelativeLink`] as boolean | undefined,
    data[`${prefix}TitleCase`] as boolean | undefined,
    undefined, // iterator
    data[`${prefix}Format`] as string | undefined,
    data[`${prefix}CustomDateFormat`] as string | undefined,
  );
}

function cleanTransformerRules(rules: unknown) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule: any) => ({
      field: rule.field ?? "title",
      type: rule.type ?? "contains",
      value: String(rule.value ?? "").trim(),
      caseSensitive: Boolean(rule.caseSensitive),
    }))
    .filter((rule) => rule.value);
}

export function castFeedFormDataToFeedConfig(
  data: FormInput,
  context: CastContext,
): FeedConfig {
  const feedId = context.feedId ?? uuidv4();
  const feedType = (data.feedType as string) === "api" ? "rest" : (data.feedType as string);
  const encKey = context.encryptionKey;

  const rawHeaders = (data.headers as Record<string, unknown>) ?? {};
  const headers = encryptPendingProtectedValues(rawHeaders, encKey);

  const base = {
    schemaVersion: 2 as const,
    feedId,
    feedName: (data.feedName as string) ?? "RSS Feed",
    feedType,
    enabled: true,
    refreshTime: Number(data.refreshTime) || 5,
    reverse: (data.reverse as boolean) ?? false,
    strict: (data.strict as boolean) ?? false,
    advanced: (data.advanced as boolean) ?? false,
    headers,
    cookies: Array.isArray(data.cookies) ? data.cookies : [],
    webhook: (data.webhook as any)?.enabled && (data.webhook as any)?.url ? {
      enabled: true,
      url: (data.webhook as any).url,
      format: (data.webhook as any).format ?? "xml",
      newItemsOnly: (data.webhook as any).newItemsOnly ?? true,
    } : undefined,
    flaresolverr: (data.flaresolverr as any)?.enabled && (data.flaresolverr as any)?.serverUrl ? {
      enabled: true,
      serverUrl: (data.flaresolverr as any).serverUrl,
      timeout: (data.flaresolverr as any).timeout ?? 60000,
    } : undefined,
    ...defaultFeedRssMetadata,
    feedLanguage: (data.feedLanguage as string) ?? "",
    feedDescription: (data.feedDescription as string) ?? "",
  };

  if (feedType === "webScraping") {
    const d = data as Record<string, unknown>;
    const iterator = buildCSSTargetFromForm("item", d) ?? new CSSTarget((data.itemSelector as string) ?? "");
    const extractionMode = (data.extractionMode as string | undefined) ?? (data.extraction as any)?.mode;
    const extraction = extractionMode && extractionMode !== "cssSelectors"
      ? {
          mode: extractionMode,
          mappings: {
            title: (data.jsonLdTitlePath as string) || "headline",
            description: (data.jsonLdDescriptionPath as string) || "description",
            link: (data.jsonLdLinkPath as string) || "url",
            pubDate: (data.jsonLdDatePath as string) || "datePublished",
            author: (data.jsonLdAuthorPath as string) || "author.name",
            guid: (data.jsonLdGuidPath as string) || "url",
            content: (data.jsonLdContentPath as string) || "articleBody",
            categories: (data.jsonLdCategoriesPath as string) || "keywords",
          },
          drillChain: Array.isArray((data.extraction as any)?.drillChain) ? (data.extraction as any).drillChain : undefined,
        }
      : undefined;
    return {
      ...base,
      feedType: "webScraping",
      config: {
        baseUrl: (data.feedUrl as string) ?? "",
        request: data.requestMode === "form"
          ? {
              mode: "form",
              proxyProfileId: data.proxyProfileId as string | undefined,
              userAgentProfileId: data.userAgentProfileId as string | undefined,
              userAgentOverride: data.userAgentOverride as string | undefined,
              method: (data.formMethod as any) ?? "GET",
              actionUrl: (data.formActionUrl as string) || (data.feedUrl as string) || "",
              encoding: (data.formEncoding as any) ?? "application/x-www-form-urlencoded",
              fields: kvPairsToRecord(data.formFields),
              submit: { followRedirects: true, scrape: "finalResponse" },
            }
          : {
              mode: "simple",
              proxyProfileId: data.proxyProfileId as string | undefined,
              userAgentProfileId: data.userAgentProfileId as string | undefined,
              userAgentOverride: data.userAgentOverride as string | undefined,
            },
      },
      extraction,
      article: {
        iterator,
        title:          buildCSSTargetFromForm("title", d),
        link:           buildCSSTargetFromForm("link", d),
        description:    buildCSSTargetFromForm("description", d),
        author:         buildCSSTargetFromForm("author", d),
        categories:     buildCSSTargetFromForm("categories", d),
        comments:       buildCSSTargetFromForm("commentsUrl", d),
        enclosure:      buildCSSTargetFromForm("enclosure", d),
        guid:           buildCSSTargetFromForm("guid", d),
        date:           buildCSSTargetFromForm("date", d),
        pubDate:        buildCSSTargetFromForm("date", d),
        contentEncoded: buildCSSTargetFromForm("contentEncoded", d),
        summary:        buildCSSTargetFromForm("summary", d),
        contributors:   buildCSSTargetFromForm("contributors", d),
        lat:            buildCSSTargetFromForm("lat", d),
        long:           buildCSSTargetFromForm("long", d),
        source: {
          title: buildCSSTargetFromForm("sourceTitle", d) ?? new CSSTarget(),
          url:   buildCSSTargetFromForm("sourceUrl",   d) ?? new CSSTarget(),
        },
      },
    } as WebScrapingFeedConfig;
  }

  if (feedType === "rest") {
    return {
      ...base,
      feedType: "rest",
      config: {
        baseUrl:            (data.feedUrl as string) ?? "",
        method:             (data.apiMethod as string) ?? "GET",
        route:              (data.apiRoute as string) ?? "",
        params:             encryptPendingProtectedValues(kvPairsToRecord(data.apiParams), encKey),
        apiSpecificHeaders: encryptPendingProtectedValues(kvPairsToRecord(data.apiHeaders), encKey),
        apiSpecificBody:    kvPairsToRecord(data.apiBody),
        advanced:           (data.advanced as boolean) ?? false,
      },
      apiMapping: {
        items:                 (data.apiItemsPath as string) ?? "",
        title:                 (data.apiTitleField as string) ?? "",
        link:                  (data.apiLinkField as string) ?? "",
        description:           (data.apiDescriptionField as string) ?? "",
        author:                (data.apiAuthor as string) ?? "",
        date:                  (data.apiDateField as string) ?? "",
        guid:                  (data.apiGuid as string) ?? "",
        enclosureUrl:          (data.apiEnclosureUrl as string) ?? "",
        enclosureLength:       (data.apiEnclosureSize as string) ?? "",
        enclosureType:         (data.apiEnclosureType as string) ?? "",
        contentEncoded:        (data.apiContentEncoded as string) ?? "",
        summary:               (data.apiSummary as string) ?? "",
        contributors:          (data.apiContributors as string) ?? "",
        lat:                   (data.apiLat as string) ?? "",
        long:                  (data.apiLong as string) ?? "",
        categories:            (data.apiCategories as string) ?? "",
        comments:              (data.apiCommentsUrl as string) ?? "",
        sourceTitle:           (data.apiSourceTitle as string) ?? "",
        sourceUrl:             (data.apiSourceUrl as string) ?? "",
        feedTitlePath:         (data.apiFeedTitle as string) ?? "",
        feedDescriptionPath:   (data.apiFeedDescription as string) ?? "",
        feedLanguagePath:      (data.apiFeedLanguage as string) ?? "",
        feedCopyrightPath:     (data.apiFeedCopyright as string) ?? "",
        feedManagingEditorPath:(data.apiFeedManagingEditor as string) ?? "",
        feedWebMasterPath:     (data.apiFeedWebMaster as string) ?? "",
        feedPubDatePath:       (data.apiFeedPubDate as string) ?? "",
        feedCategoriesPath:    (data.apiFeedCategories as string) ?? "",
        feedTtlPath:           (data.apiFeedTtl as string) ?? "",
        feedSkipHoursPath:     (data.apiFeedSkipHours as string) ?? "",
        feedSkipDaysPath:      (data.apiFeedSkipDays as string) ?? "",
        feedImageUrl:          (data.apiFeedImageUrl as string) ?? "",
      },
    } as RestFeedConfig;
  }

  if (feedType === "email") {
    return {
      ...base,
      feedType: "email",
      feedLanguage: "en",
      feedDescription: `Emails from folder: ${(data.emailFolder as string) ?? "INBOX"}`,
      config: {
        host:       (data.emailHost as string) ?? "",
        port:       Number(data.emailPort) || 993,
        user:       (data.emailUsername as string) ?? "",
        folder:     (data.emailFolder as string) ?? "INBOX",
        emailCount: Number(data.emailCount) || 10,
        password:   data.emailPassword
          ? protectValue(data.emailPassword as string, encKey)
          : undefined,
      },
    } as EmailFeedConfig;
  }

  if (feedType === "feedTransformer") {
    const sources = Array.isArray(data.transformerSources)
      ? data.transformerSources
      : Array.isArray((data.feedTransformer as any)?.sources)
        ? (data.feedTransformer as any).sources
        : [];
    return {
      ...base,
      feedType: "feedTransformer",
      feedTransformer: {
        sources: sources
          .map((source: any) => ({
            url: String(source.url ?? "").trim(),
            format: source.format ?? "auto",
            headers: source.headers ?? {},
          }))
          .filter((source: any) => source.url),
        mergeStrategy: (data.transformerMergeStrategy as any) ?? (data.feedTransformer as any)?.mergeStrategy ?? "dateDesc",
        maxItems: Number(data.transformerMaxItems ?? (data.feedTransformer as any)?.maxItems) || undefined,
        dedupeAcrossSources: (data.transformerDedupeAcrossSources as boolean | undefined) ?? (data.feedTransformer as any)?.dedupeAcrossSources ?? true,
        feed: (data.feedTransformer as any)?.feed ?? {
          title: data.transformerFeedTitle as string | undefined,
          description: data.transformerFeedDescription as string | undefined,
          link: data.transformerFeedLink as string | undefined,
        },
        items: (data.feedTransformer as any)?.items ?? {
          guidStrategy: (data.transformerGuidStrategy as any) ?? "existingOrLinkHash",
          dateStrategy: (data.transformerDateStrategy as any) ?? "publishedOrUpdatedOrFetched",
          description: {
            stripHtml: Boolean(data.transformerStripDescriptionHtml),
            normalizeWhitespace: Boolean(data.transformerNormalizeWhitespace),
          },
          content: {
            normalizeWhitespace: Boolean(data.transformerNormalizeWhitespace),
          },
          link: {
            removeTrackingParams: data.transformerRemoveTrackingParams !== false,
            forceHttps: Boolean(data.transformerForceHttps),
          },
          categories: {
            normalizeWhitespace: Boolean(data.transformerNormalizeCategories),
            dedupe: Boolean(data.transformerNormalizeCategories),
            lowercase: false,
          },
          filters: {
            include: cleanTransformerRules(data.transformerFilterInclude),
            exclude: cleanTransformerRules(data.transformerFilterExclude),
          },
        },
      },
    } as FeedTransformerFeedConfig;
  }

  if (feedType === "sitemap") {
    return {
      ...base,
      feedType: "sitemap",
      sitemap: {
        inputMode: (data.sitemapInputMode as any) ?? "exact",
        url: (data.sitemapUrl as string) ?? (data.feedUrl as string) ?? "",
        mode: (data.sitemapMode as any) ?? "urlList",
        maxItems: Number(data.sitemapMaxItems) || 50,
        maxUrlsToScan: Number(data.sitemapMaxUrlsToScan) || 500,
        sortOrder: (data.sitemapSortOrder as any) ?? "lastmodDesc",
        dateStrategy: (data.sitemapDateStrategy as any) ?? "lastmodOrFirstSeen",
        titleStrategy: (data.sitemapTitleStrategy as any) ?? "path",
        descriptionStrategy: (data.sitemapDescriptionStrategy as any) ?? "sitemapMetadata",
      },
    } as SitemapFeedConfig;
  }

  if (feedType === "calendar") {
    return {
      ...base,
      feedType: "calendar",
      calendar: {
        url: (data.calendarUrl as string) ?? (data.feedUrl as string) ?? "",
        windowDays: Number(data.calendarWindowDays) || 30,
        includePastEvents: Boolean(data.calendarIncludePastEvents),
        expandRecurringEvents: data.calendarExpandRecurringEvents !== false,
        maxEvents: Number(data.calendarMaxEvents) || 50,
        sortOrder: (data.calendarSortOrder as any) ?? "startAsc",
        dateStrategy: (data.calendarDateStrategy as any) ?? "start",
        linkStrategy: (data.calendarLinkStrategy as any) ?? "eventUrl",
        timezoneFallback: (data.calendarTimezoneFallback as string) || undefined,
        includeCanceled: Boolean(data.calendarIncludeCanceled),
      },
    } as CalendarFeedConfig;
  }

  if (feedType === "graphql") {
    return {
      ...base,
      feedType: "graphql",
      graphql: {
        endpoint: (data.graphqlEndpoint as string) ?? (data.feedUrl as string) ?? "",
        method: "POST",
        headers: encryptPendingProtectedValues(kvPairsToRecord(data.graphqlHeaders), encKey),
        query: (data.graphqlQuery as string) ?? "",
        variables: tryJsonObject(data.graphqlVariables),
        operationName: (data.graphqlOperationName as string) || undefined,
        timeoutMs: Number(data.graphqlTimeoutMs) || 60000,
        mapping: {
          itemPath: (data.graphqlItemPath as string) ?? "data.items",
          title: (data.graphqlTitlePath as string) || "title",
          link: (data.graphqlLinkPath as string) || "url",
          description: (data.graphqlDescriptionPath as string) || "description",
          pubDate: (data.graphqlDatePath as string) || "publishedAt",
          guid: (data.graphqlGuidPath as string) || "id",
          author: (data.graphqlAuthorPath as string) || "author.name",
          categories: (data.graphqlCategoriesPath as string) || "categories",
        },
        pagination: { enabled: false },
      },
    } as GraphQLFeedConfig;
  }

  if (feedType === "filesystem") {
    return {
      ...base,
      feedType: "filesystem",
      filesystem: {
        rootPath: (data.filesystemRootPath as string) ?? "",
        publicBaseUrl: (data.filesystemPublicBaseUrl as string) || undefined,
        recursive: data.filesystemRecursive !== false,
        include: splitList(data.filesystemInclude, ["*"]),
        exclude: splitList(data.filesystemExclude),
        maxItems: Number(data.filesystemMaxItems) || 50,
        sortOrder: (data.filesystemSortOrder as any) ?? "modifiedDesc",
        dateStrategy: (data.filesystemDateStrategy as any) ?? "modifiedTime",
        guidStrategy: (data.filesystemGuidStrategy as any) ?? "pathAndModifiedTime",
        titleStrategy: (data.filesystemTitleStrategy as any) ?? "filename",
        descriptionStrategy: (data.filesystemDescriptionStrategy as any) ?? "fileMetadata",
        sidecar: { enabled: Boolean(data.filesystemSidecarEnabled), extension: (data.filesystemSidecarExtension as string) || ".json" },
        extraction: {
          enabled: Boolean(data.filesystemExtractionEnabled),
          maxCharacters: Number(data.filesystemExtractionMaxCharacters) || 400,
          maxFileSizeBytes: Number(data.filesystemExtractionMaxFileSizeBytes) || 262144,
          supportedExtensions: splitList(data.filesystemExtractionExtensions, ["txt", "md", "html"]),
        },
      },
    } as FilesystemFeedConfig;
  }

  if (feedType === "webhook") {
    const token = (data.webhookToken as string) || generateWebhookToken();
    return {
      ...base,
      feedType: "webhook",
      webhookFeed: {
        slug: (data.webhookSlug as string) ?? feedId,
        tokenHash: (data.webhookTokenHash as string) || hashWebhookToken(token),
        maxItems: Number(data.webhookMaxItems) || 50,
        retentionDays: Number(data.webhookRetentionDays) || 30,
        duplicateStrategy: (data.webhookDuplicateStrategy as any) ?? "idOrHash",
        dateStrategy: (data.webhookDateStrategy as any) ?? "payloadDateOrReceivedAt",
        storeRawPayload: Boolean(data.webhookStoreRawPayload),
        mapping: { mode: "native" },
      },
    } as WebhookFeedConfig;
  }

  if (feedType === "serviceConnector") {
    const apiKey = data.serviceConnectorApiKey
      ? protectValue(String(data.serviceConnectorApiKey), encKey)
      : (data.serviceConnector as any)?.connection?.auth?.fields?.apiKey;
    return {
      ...base,
      feedType: "serviceConnector",
      metadata: {
        ...((data.metadata as any) ?? {}),
        localOnly: (data.metadata as any)?.localOnly ?? true,
        visibility: (data.metadata as any)?.visibility ?? "private",
      },
      serviceConnector: {
        service: (data.serviceConnectorService as string) ?? (data.serviceConnector as any)?.service ?? "jellyfin",
        connection: {
          label: (data.serviceConnectorLabel as string) || undefined,
          settings: {
            serverUrl: (data.serviceConnectorServerUrl as string) ?? (data.serviceConnector as any)?.connection?.settings?.serverUrl ?? "",
          },
          auth: {
            mode: "apiKey",
            fields: apiKey ? { apiKey } : {},
          },
        },
        resource: {
          type: "library",
          id: (data.serviceConnectorResourceId as string) ?? (data.serviceConnector as any)?.resource?.id ?? "",
          label: (data.serviceConnectorResourceLabel as string) ?? (data.serviceConnector as any)?.resource?.label,
        },
        preset: (data.serviceConnectorPreset as string) ?? (data.serviceConnector as any)?.preset ?? "latestItems",
        options: { limit: Number(data.serviceConnectorLimit) || 50 },
        cursor: { strategy: "latestTimestamp", field: "DateCreated" },
      },
    } as ServiceConnectorFeedConfig;
  }

  throw new Error(`castFeedFormDataToFeedConfig: unsupported feedType "${feedType}"`);
}

function tryJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function splitList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") {
    const list = value.split(",").map((v) => v.trim()).filter(Boolean);
    return list.length ? list : fallback;
  }
  return fallback;
}

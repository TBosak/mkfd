import { v4 as uuidv4 } from "uuid";
import { isProtectedValue, protectValue } from "./protected-values.utility";
import type { ProtectedRecord } from "../models/protected-value.model";
import type { FeedConfig, WebScrapingFeedConfig, RestFeedConfig, EmailFeedConfig } from "../models/feed-config.model";
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
    return {
      ...base,
      feedType: "webScraping",
      config: { baseUrl: (data.feedUrl as string) ?? "" },
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

  throw new Error(`castFeedFormDataToFeedConfig: unsupported feedType "${feedType}"`);
}

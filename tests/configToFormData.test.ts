import { test, expect, describe } from "bun:test";
import { configToFormData } from "../frontend/src/lib/configToFormData";

const baseWebScrapingConfig = {
  feedId: "abc-123",
  feedName: "Test Feed",
  feedType: "webScraping",
  refreshTime: 10,
  reverse: true,
  advanced: false,
  strict: false,
  headers: { "X-Auth": "token123" },
  cookies: [{ name: "session", value: "abc" }],
  config: { baseUrl: "https://example.com" },
  article: {
    iterator: { selector: ".article", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    title: { selector: "h2", attribute: "", stripHtml: true, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    link: { selector: "a", attribute: "href", stripHtml: false, baseUrl: "https://example.com", isRelative: true, titleCase: false, iterator: "", dateFormat: "", drillChain: [{ selector: ".inner", attribute: "href", isRelative: false, baseUrl: "", stripHtml: false }] },
    description: { selector: "p", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    author: { selector: ".author", attribute: "", stripHtml: true, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    categories: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    comments: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    enclosure: { selector: "img", attribute: "src", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    guid: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", guidIsPermaLink: false, drillChain: [] },
    pubDate: { selector: ".date", attribute: "datetime", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "DD/MM/YYYY", drillChain: [] },
    source: {
      title: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
      url: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    },
    contentEncoded: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    summary: { selector: ".excerpt", attribute: "", stripHtml: true, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    contributors: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    lat: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
    long: { selector: "", attribute: "", stripHtml: false, baseUrl: "", isRelative: false, titleCase: false, iterator: "", dateFormat: "", drillChain: [] },
  },
  feedLanguage: "",
  feedCopyright: "",
  feedManagingEditor: "",
  feedWebMaster: "",
  feedDescription: "",
  feedPubDate: "",
  feedLastBuildDate: "",
  feedCategories: [],
  feedDocs: "https://www.rssboard.org/rss-specification",
  feedGenerator: "MkFD Feed Generator",
  feedSkipHours: [],
  feedSkipDays: [],
};

describe("configToFormData – webScraping", () => {
  test("maps common fields", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.feedName).toBe("Test Feed");
    expect(result.feedType).toBe("webScraping");
    expect(result.refreshTime).toBe(10);
    expect(result.reverse).toBe(true);
    expect(result.advanced).toBe(false);
    expect(result.strict).toBe(false);
  });

  test("maps feedUrl from config.baseUrl", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.feedUrl).toBe("https://example.com");
  });

  test("maps itemSelector from article.iterator.selector", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.itemSelector).toBe(".article");
  });

  test("maps title selector fields", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.titleSelector).toBe("h2");
    expect(result.titleStripHtml).toBe(true);
  });

  test("maps link selector with isRelative and baseUrl", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.linkSelector).toBe("a");
    expect(result.linkAttribute).toBe("href");
    expect(result.linkRelativeLink).toBe(true);
    expect(result.linkBaseUrl).toBe("https://example.com");
  });

  test("maps drillChain arrays", () => {
    const result = configToFormData(baseWebScrapingConfig) as any;
    expect(result.linkDrillChain).toEqual([{ selector: ".inner", attribute: "href", isRelative: false, baseUrl: "", stripHtml: false }]);
  });

  test("maps date selector with dateFormat", () => {
    const result = configToFormData(baseWebScrapingConfig) as any;
    expect(result.dateSelector).toBe(".date");
    expect(result.dateAttribute).toBe("datetime");
    expect(result.dateFormat).toBe("DD/MM/YYYY");
  });

  test("maps headers object to KeyValuePair array", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.headers).toEqual([{ key: "X-Auth", value: "token123" }]);
  });

  test("passes cookies array through unchanged", () => {
    const result = configToFormData(baseWebScrapingConfig);
    expect(result.cookies).toEqual([{ name: "session", value: "abc" }]);
  });

  test("parses feedLanguage selector|attr string", () => {
    const config = { ...baseWebScrapingConfig, feedLanguage: "span.lang|attr:data-lang" };
    const result = configToFormData(config) as any;
    expect(result.feedLanguageSelector).toBe("span.lang");
    expect(result.feedLanguageAttribute).toBe("data-lang");
  });

  test("handles plain feedLanguage selector with no attribute", () => {
    const config = { ...baseWebScrapingConfig, feedLanguage: "span.lang" };
    const result = configToFormData(config) as any;
    expect(result.feedLanguageSelector).toBe("span.lang");
    expect(result.feedLanguageAttribute).toBe("");
  });

  test("maps iterator fields for article sub-fields", () => {
    const config = {
      ...baseWebScrapingConfig,
      article: {
        ...baseWebScrapingConfig.article,
        title: { ...baseWebScrapingConfig.article.title, iterator: "li" },
      },
    };
    const result = configToFormData(config) as any;
    expect(result.titleIterator).toBe("li");
  });

  test("maps webhook config to form shape", () => {
    const config = {
      ...baseWebScrapingConfig,
      webhook: {
        enabled: true,
        url: "https://hooks.example.com",
        format: "json",
        newItemsOnly: false,
        headers: { Authorization: "Bearer tok" },
        customPayload: '{"msg":"hi"}',
      },
    };
    const result = configToFormData(config);
    expect(result.webhook?.enabled).toBe(true);
    expect(result.webhook?.url).toBe("https://hooks.example.com");
    expect(result.webhook?.format).toBe("json");
    expect(result.webhook?.newItemsOnly).toBe(false);
    expect(result.webhook?.headers).toBe('{"Authorization":"Bearer tok"}');
    expect(result.webhook?.customPayload).toBe('{"msg":"hi"}');
  });
});

describe("configToFormData – api", () => {
  const apiConfig = {
    feedId: "def-456",
    feedName: "API Feed",
    feedType: "api",
    refreshTime: 5,
    reverse: false,
    advanced: false,
    strict: false,
    headers: {},
    cookies: [],
    config: {
      baseUrl: "https://api.example.com",
      route: "/v1/posts",
      method: "GET",
      params: { page: "1" },
      apiSpecificHeaders: { "X-API-Key": "secret" },
      apiSpecificBody: {},
    },
    apiMapping: {
      items: "data.posts",
      title: "title",
      link: "url",
      description: "body",
      date: "createdAt",
      author: "",
      categories: "",
      guid: "",
      guidIsPermaLink: "",
      enclosureUrl: "",
      enclosureLength: "",
      enclosureType: "",
      contentEncoded: "",
      summary: "",
      contributors: "",
      lat: "",
      long: "",
      sourceUrl: "",
      sourceTitle: "",
      feedTitlePath: "meta.title",
      feedDescriptionPath: "",
      feedLanguagePath: "",
      feedCopyrightPath: "",
      feedManagingEditorPath: "",
      feedWebMasterPath: "",
      feedPubDatePath: "",
      feedCategoriesPath: "",
      feedTtlPath: "",
      feedSkipHoursPath: "",
      feedSkipDaysPath: "",
      feedImageUrl: "",
    },
  };

  test("maps api config fields", () => {
    const result = configToFormData(apiConfig);
    expect(result.feedUrl).toBe("https://api.example.com");
    expect(result.apiRoute).toBe("/v1/posts");
    expect(result.apiMethod).toBe("GET");
    expect(result.apiParams).toEqual([{ key: "page", value: "1" }]);
    expect(result.apiHeaders).toEqual([{ key: "X-API-Key", value: "secret" }]);
  });

  test("maps apiMapping fields", () => {
    const result = configToFormData(apiConfig);
    expect(result.apiItemsPath).toBe("data.posts");
    expect(result.apiTitleField).toBe("title");
    expect(result.apiLinkField).toBe("url");
    expect(result.apiDateField).toBe("createdAt");
    expect(result.apiFeedTitle).toBe("meta.title");
  });
});

describe("configToFormData – email", () => {
  const emailConfig = {
    feedId: "ghi-789",
    feedName: "Email Feed",
    feedType: "email",
    refreshTime: 5,
    reverse: false,
    advanced: false,
    strict: false,
    headers: {},
    cookies: [],
    config: {
      host: "imap.gmail.com",
      port: 993,
      user: "test@gmail.com",
      encryptedPassword: "encrypted-blob",
      folder: "INBOX",
      emailCount: 20,
    },
  };

  test("maps email config fields", () => {
    const result = configToFormData(emailConfig);
    expect(result.emailHost).toBe("imap.gmail.com");
    expect(result.emailPort).toBe(993);
    expect(result.emailUsername).toBe("test@gmail.com");
    expect(result.emailFolder).toBe("INBOX");
    expect(result.emailCount).toBe(20);
  });

  test("blanks password (never exposes encrypted value)", () => {
    const result = configToFormData(emailConfig);
    expect(result.emailPassword).toBe("");
  });
});

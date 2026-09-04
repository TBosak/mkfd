import { describe, test, expect } from "bun:test";
import * as cheerio from "cheerio";
import { get, processWords, resolveDrillChain } from "../utilities/data-handler.utility";
import { discoverUrl, looksLikeUrl } from "../utilities/rss-builder.utility";

// ---------------------------------------------------------------------------
// Specifies Amendment 1.D1 to the `p1-fallow-static-analysis-gate` brief:
// the `utilities/data-handler.utility.ts` <-> `utilities/rss-builder.utility.ts`
// circular dependency must be untangled (fallow flags it as an
// initialization/tree-shaking risk; see the oracle-based assertion in
// tests/fallow-static-analysis-gate.test.ts, describe block "Amendment
// 1.D1"). Untangling means extracting shared logic into a third module or
// reordering the two files' own exports/imports - it must NOT change what
// any of the six exports crossing the cycle actually do.
//
// This file locks the observable behavior of every export directly involved
// in the cycle, so the untangling is proven safe rather than assumed:
//   - data-handler.utility.ts exports imported BY rss-builder.utility.ts:
//     `processWords`, `get`, `resolveDrillChain` (`processDates` is the
//     fourth import, already covered by tests/data-handler.test.ts - not
//     duplicated here).
//   - rss-builder.utility.ts exports imported BY data-handler.utility.ts:
//     `discoverUrl`, `looksLikeUrl`.
//
// Both modules are imported together deliberately (rather than the
// pre-existing tests/data-handler.test.ts / tests/rss-builder.test.ts,
// which each import only one side): this is itself a live check that the
// current circular import resolves without a use-before-initialization
// failure, both before and after the untangling.
// ---------------------------------------------------------------------------

describe("sanity: both sides of the cycle import successfully together", () => {
  test("processWords, get, resolveDrillChain, discoverUrl, and looksLikeUrl are all defined callables", () => {
    expect(typeof processWords).toBe("function");
    expect(typeof get).toBe("function");
    expect(typeof resolveDrillChain).toBe("function");
    expect(typeof discoverUrl).toBe("function");
    expect(typeof looksLikeUrl).toBe("function");
  });
});

// --------------------------- data-handler.utility.ts side ---------------------------

describe("processWords (data-handler.utility.ts, imported by rss-builder.utility.ts)", () => {
  test("returns the input unchanged when no flags are set", () => {
    expect(processWords("Hello <b>World</b>")).toBe("Hello <b>World</b>");
  });

  test("defaults to an empty string when words is undefined", () => {
    expect(processWords(undefined)).toBe("");
  });

  test("strips HTML tags when removeHtml is true", () => {
    expect(processWords("Hello <b>World</b>", false, true)).toBe("Hello World");
  });

  test("applies title case when title is true", () => {
    expect(processWords("hello world", true, false)).toBe("Hello World");
  });

  test("applies both removeHtml and title case together, HTML stripped before casing", () => {
    expect(processWords("hello <b>world</b>", true, true)).toBe("Hello World");
  });
});

describe("get (data-handler.utility.ts, imported by rss-builder.utility.ts)", () => {
  test("resolves a nested dotted path", () => {
    expect(get({ a: { b: { c: 42 } } }, "a.b.c", 0)).toBe(42);
  });

  test("returns the default value when the path does not exist", () => {
    expect(get({ a: {} }, "a.b.c", "fallback")).toBe("fallback");
  });

  test("returns the default value when path is undefined", () => {
    expect(get({ a: 1 }, undefined, "fallback")).toBe("fallback");
  });

  test("returns the default value when a middle segment is not an object", () => {
    expect(get({ a: 5 }, "a.b", "fallback")).toBe("fallback");
  });

  test("returns the default value for a null object", () => {
    expect(get(null, "a.b", "fallback")).toBe("fallback");
  });

  test("resolves a single-segment path", () => {
    expect(get({ x: "y" }, "x", "fallback")).toBe("y");
  });
});

describe("resolveDrillChain (data-handler.utility.ts, imported by rss-builder.utility.ts)", () => {
  // Only the deterministic, offline-safe fast path is locked here: an empty
  // chain returns "" immediately without touching the network or spawning a
  // browser. The network/browser-driven branches are out of scope per the
  // "no live third-party services" constraint on this test suite.
  test(
    "returns an empty string immediately for an empty chain, without throwing",
    async () => {
      await expect(resolveDrillChain("https://example.com", [])).resolves.toBe("");
    },
    5_000,
  );

  test(
    "returns an empty string immediately for a null/undefined chain",
    async () => {
      // @ts-expect-error - deliberately exercising the `!chain` guard with an out-of-contract input
      await expect(resolveDrillChain("https://example.com", null)).resolves.toBe("");
    },
    5_000,
  );
});

// --------------------------- rss-builder.utility.ts side ---------------------------

describe("looksLikeUrl (rss-builder.utility.ts, imported by data-handler.utility.ts)", () => {
  test("true for an http URL", () => {
    expect(looksLikeUrl("http://example.com/a.png")).toBe(true);
  });

  test("true for an https URL", () => {
    expect(looksLikeUrl("https://example.com/a.png")).toBe(true);
  });

  test("true for a protocol-relative URL", () => {
    expect(looksLikeUrl("//example.com/a.png")).toBe(true);
  });

  test("false for a bare relative path", () => {
    expect(looksLikeUrl("/a.png")).toBe(false);
  });

  test("false for a bare hostname with no scheme", () => {
    expect(looksLikeUrl("example.com/a.png")).toBe(false);
  });

  test("false for an empty string", () => {
    expect(looksLikeUrl("")).toBe(false);
  });

  test("is case-insensitive on the scheme", () => {
    expect(looksLikeUrl("HTTPS://example.com/a.png")).toBe(true);
  });
});

describe("discoverUrl (rss-builder.utility.ts, imported by data-handler.utility.ts)", () => {
  test("returns '' immediately for an empty target selection", () => {
    const $ = cheerio.load("<div></div>");
    const target = $(".does-not-exist");
    expect(discoverUrl($, target)).toBe("");
  });

  test("prefers a direct href attribute when it looks like a URL", () => {
    const $ = cheerio.load('<a href="https://example.com/article"></a>');
    const target = $("a");
    expect(discoverUrl($, target)).toBe("https://example.com/article");
  });

  test("prefers a direct src attribute over nested content when href is absent", () => {
    const $ = cheerio.load('<img src="https://example.com/image.png" />');
    const target = $("img");
    expect(discoverUrl($, target)).toBe("https://example.com/image.png");
  });

  test("falls back to data-src when href/src do not look like URLs", () => {
    const $ = cheerio.load('<img data-src="https://example.com/lazy.png" />');
    const target = $("img");
    expect(discoverUrl($, target)).toBe("https://example.com/lazy.png");
  });

  test("falls back to the first srcset candidate when nothing else matches", () => {
    const $ = cheerio.load('<img srcset="https://example.com/one.png 1x, https://example.com/two.png 2x" />');
    const target = $("img");
    expect(discoverUrl($, target)).toBe("https://example.com/one.png");
  });

  test("falls back to a nested <a href> when no direct attribute matches", () => {
    const $ = cheerio.load('<div><span>text</span><a href="https://example.com/nested">link</a></div>');
    const target = $("div").first();
    expect(discoverUrl($, target)).toBe("https://example.com/nested");
  });

  test("decodes a percent-encoded URL", () => {
    const $ = cheerio.load('<a href="https://example.com/a%20b"></a>');
    const target = $("a");
    expect(discoverUrl($, target)).toBe("https://example.com/a b");
  });

  test("returns '' when the target has no discoverable URL anywhere", () => {
    const $ = cheerio.load("<div><span>just text, no links or media</span></div>");
    const target = $("div").first();
    expect(discoverUrl($, target)).toBe("");
  });
});

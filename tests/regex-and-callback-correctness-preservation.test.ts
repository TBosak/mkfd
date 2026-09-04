import { describe, test, expect } from "bun:test";
import * as cheerio from "cheerio";
import { sanitizeForXML, sanitizeURLForXML } from "../utilities/xml-sanitizer.utility";
import { buildRSSFromEmailFolder, extractEmailItems } from "../node/imap-watch.utility";
import type { Email } from "../node/imap-watch.utility";
import { findJsonArrayPathCandidates } from "../utilities/structured-feed.utility";
import { discoverUrl } from "../utilities/rss-builder.utility";

// ---------------------------------------------------------------------------
// Specifies requirement 6 of the `p1-static-diagnostics-cleanup` brief for
// two currently error-producing correctness rule families:
//
//  - `lint/suspicious/noControlCharactersInRegex` on the control-character
//    stripping regex duplicated in `utilities/xml-sanitizer.utility.ts`
//    (`sanitizeForXML`) and `node/imap-watch.utility.ts`
//    (`buildRSSFromEmailFolder`'s local `sanitizeForXML` closure, applied to
//    the email subject -> feed item title). "Regex fixes retain their
//    accepted character coverage" (brief requirement 6) means: whatever the
//    rule-satisfying rewrite looks like (character-code filtering,
//    Unicode-escape reconstruction, etc.), the exact same set of code
//    points must still be treated as invalid-and-removed, and the three
//    XML-safe whitespace control characters (tab/LF/CR) must still survive.
//    These tests exercise the real character-code boundary through the
//    public API, so a narrower or wider replacement regex fails here
//    regardless of how the lint fix is implemented.
//
//  - `lint/suspicious/useIterableCallbackReturn` on the recursive
//    `.forEach(...)` walk in `findJsonArrayPathCandidates`
//    (`utilities/structured-feed.utility.ts`). The walker relies on an
//    early `return;` after the array branch to avoid *also* falling through
//    into the object-entries branch for the same array value; if a
//    braces-only mechanical fix drops that `return`, the walk silently
//    double-visits every array node. This is exactly the "switch/control-flow
//    changes preserve branches" / "no unsafe parsing" concern in
//    requirement 6.
//
//  - `lint/suspicious/noAssignInExpressions` on
//    `while ((m = ABS_URL_RE.exec(html)))` inside the private
//    `nextUsefulAbs` helper in `utilities/rss-builder.utility.ts`. That
//    helper is reachable only through the exported `discoverUrl`'s
//    fallback-branch-7 ("any plausible URL in outerHTML"), which is the
//    least-reliable, last-resort discovery path - reached only when none of
//    href/src/data-src/srcset/ld+json/og:meta/inline-style/nested-media/
//    nested-link branches produce a URL. A conditional-assignment rewrite
//    (`let m = ABS_URL_RE.exec(html); while (m) { ...; m = ABS_URL_RE.exec(html); }`)
//    must keep scanning past "boring" schema.org/w3.org URLs to find the
//    first genuinely useful one, and must still return `""` when nothing
//    useful is found - exactly what the fixtures below exercise through the
//    public `discoverUrl` entry point, without needing to export the
//    private helper.
//
// None of these tests require RED today: the current implementations are
// functionally correct (only their lint status is wrong), so this suite is
// a behavior-preservation safety net that must stay green through the fix,
// not a proof of currently-missing behavior. (See the architecture suite for
// the RED proof that these files currently fail `bun run lint`.)
// ---------------------------------------------------------------------------

// --------------------------- xml-sanitizer.utility.ts: control-character coverage ---------------------------

const STRIPPED_CONTROL_CODES: number[] = [];
for (let code = 0x00; code <= 0x08; code++) STRIPPED_CONTROL_CODES.push(code);
STRIPPED_CONTROL_CODES.push(0x0b, 0x0c);
for (let code = 0x0e; code <= 0x1f; code++) STRIPPED_CONTROL_CODES.push(code);
STRIPPED_CONTROL_CODES.push(0x7f);

const PRESERVED_WHITESPACE_CODES = [0x09, 0x0a, 0x0d]; // tab, LF, CR

describe("sanitizeForXML strips exactly the documented invalid-XML control character set", () => {
  for (const code of STRIPPED_CONTROL_CODES) {
    test(`strips control character 0x${code.toString(16).padStart(2, "0")}`, () => {
      const input = `A${String.fromCharCode(code)}B`;
      expect(sanitizeForXML(input)).toBe("AB");
    });
  }

  for (const code of PRESERVED_WHITESPACE_CODES) {
    test(`preserves XML-safe whitespace control character 0x${code.toString(16).padStart(2, "0")} (tab/LF/CR)`, () => {
      const input = `A${String.fromCharCode(code)}B`;
      expect(sanitizeForXML(input)).toBe(`A${String.fromCharCode(code)}B`);
    });
  }

  test("strips every documented control character in a single mixed string, preserving surrounding text and whitespace", () => {
    const chars = STRIPPED_CONTROL_CODES.map((c) => String.fromCharCode(c)).join("");
    const input = `Title${chars}\twith\ntabs\rand\x00control${chars}chars`;
    const output = sanitizeForXML(input);
    for (const code of STRIPPED_CONTROL_CODES) {
      expect(output.includes(String.fromCharCode(code)), `code 0x${code.toString(16)} leaked into output`).toBe(false);
    }
    expect(output).toContain("Title");
    expect(output).toContain("\twith");
    expect(output).toContain("\ntabs");
    expect(output).toContain("\rand");
    expect(output).toContain("control");
    expect(output).toContain("chars");
  });

  test("still escapes XML special characters and the CDATA closing sequence (unrelated to control-character stripping)", () => {
    expect(sanitizeForXML(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
    expect(sanitizeForXML("a]]>b")).toBe("a]]&amp;gt;b");
  });

  test("passes through undefined/empty input unchanged", () => {
    expect(sanitizeForXML(undefined)).toBe("");
    expect(sanitizeForXML("")).toBe("");
  });
});

describe("sanitizeURLForXML only escapes bare ampersands, leaving other URL characters untouched", () => {
  test("escapes a bare ampersand in a query string", () => {
    expect(sanitizeURLForXML("https://example.com/?a=1&b=2")).toBe("https://example.com/?a=1&amp;b=2");
  });

  test("does not double-escape an already-encoded entity", () => {
    expect(sanitizeURLForXML("https://example.com/?a=1&amp;b=2")).toBe("https://example.com/?a=1&amp;b=2");
  });

  test("leaves path/query characters that are valid in URLs untouched", () => {
    const url = "https://example.com/path/to-page?x=1;y=2:z=3";
    expect(sanitizeURLForXML(url)).toBe(url);
  });
});

// --------------------------- imap-watch.utility.ts: email title control-character stripping ---------------------------

const SAMPLE_CONFIG = {
  id: "http://localhost:5000/public/feeds/test-email.xml",
  title: "Test Email Feed",
  link: "mailto:test@example.com",
  description: "Test email feed",
  copyright: "",
  feedId: "test-email",
  feedName: "Test Email Feed",
  feedType: "email",
  config: { folder: "INBOX", emailCount: 10 },
};

describe("buildRSSFromEmailFolder strips control characters from the email subject before it becomes the feed item title", () => {
  test("a subject containing control characters produces a title with those characters removed", () => {
    const email: Email = {
      UID: 1,
      messageId: "<control-char-test@example.com>",
      subject: "Weird\x01Subject\x07With\x1FControls",
      from: "sender@example.com",
      date: "2026-01-01T00:00:00.000Z",
      textBody: "body",
    };
    const { feed } = buildRSSFromEmailFolder([email], SAMPLE_CONFIG);
    const items = extractEmailItems(feed);
    expect(items).toHaveLength(1);
    const title = String(items[0].title ?? feed.rss2());
    for (const code of STRIPPED_CONTROL_CODES) {
      expect(title.includes(String.fromCharCode(code)), `code 0x${code.toString(16)} leaked into the title`).toBe(
        false,
      );
    }
    expect(title).toContain("Weird");
    expect(title).toContain("Subject");
    expect(title).toContain("With");
    expect(title).toContain("Controls");
  });
});

// --------------------------- structured-feed.utility.ts: recursive walk control-flow preservation ---------------------------

describe("findJsonArrayPathCandidates recurses into nested arrays exactly once per node (useIterableCallbackReturn fix must preserve the array-vs-object early return)", () => {
  test("finds a top-level array candidate", () => {
    const candidates = findJsonArrayPathCandidates({ items: [{ a: 1 }, { a: 2 }] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].path).toBe("items");
    expect(candidates[0].length).toBe(2);
  });

  test("recurses into an array nested inside an array element, producing exactly one candidate per array level (no duplicate from object-entries fallthrough)", () => {
    const candidates = findJsonArrayPathCandidates({ list: [[1, 2, 3]] });
    // Correct behavior: "list" (length 1, the outer array) and "list.0"
    // (length 3, the inner array reached via the array-element forEach walk).
    // A regression that removes the early `return` after the array branch
    // would ALSO run Object.entries on the outer array itself (treating its
    // index "0" as an object key), re-discovering "list.0" a second time
    // through the object branch - producing 3 candidates instead of 2.
    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.path).sort();
    expect(paths).toEqual(["list", "list.0"]);
    const outer = candidates.find((c) => c.path === "list");
    const inner = candidates.find((c) => c.path === "list.0");
    expect(outer?.length).toBe(1);
    expect(inner?.length).toBe(3);
  });

  test("recurses into arrays nested inside plain objects via Object.entries", () => {
    const candidates = findJsonArrayPathCandidates({ data: { edges: [{ node: { id: 1 } }, { node: { id: 2 } }] } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].path).toBe("data.edges");
    expect(candidates[0].length).toBe(2);
  });

  test("returns no candidates for input with no arrays", () => {
    expect(findJsonArrayPathCandidates({ a: { b: { c: 1 } } })).toEqual([]);
  });

  test("returns candidates sorted by descending confidence", () => {
    const candidates = findJsonArrayPathCandidates({
      short: [{ a: 1 }],
      long: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }, { a: 6 }],
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });
});

// --------------------------- rss-builder.utility.ts: discoverUrl fallback-branch assignment-loop preservation ---------------------------

describe("discoverUrl's outerHTML fallback (branch 7) keeps scanning past boring URLs to find a useful one (noAssignInExpressions fix must preserve the exec loop)", () => {
  // Deliberately has no href/src/data-src/srcset, no <script type="application/ld+json">,
  // is not <html>/<body>, no inline style background-image, no nested
  // img/video/audio, and no nested <a> - so branches 1-6 all fall through and
  // discoverUrl must reach the outerHTML fallback (branch 7), which is the
  // only branch that reaches the private `nextUsefulAbs` helper.
  test("returns the first non-boring absolute URL when it is preceded by boring (schema.org/w3.org) URLs in the outerHTML text", () => {
    const $ = cheerio.load(
      `<div id="target">See https://schema.org/context and https://www.w3.org/other before https://example.com/photo.jpg and https://example.com/second.jpg appear.</div>`,
    );
    const target = $("#target");
    expect(discoverUrl($, target)).toBe("https://example.com/photo.jpg");
  });

  test("returns '' (not a boring URL, and not a crash) when every absolute URL found is boring", () => {
    const $ = cheerio.load(`<div id="target">Only https://schema.org/a and https://www.w3.org/b appear here.</div>`);
    const target = $("#target");
    expect(discoverUrl($, target)).toBe("");
  });

  test("returns '' when the target has no href/src and no absolute URL anywhere in its outerHTML", () => {
    const $ = cheerio.load(`<div id="target">No URLs of any kind in this text.</div>`);
    const target = $("#target");
    expect(discoverUrl($, target)).toBe("");
  });

  test("returns '' for an empty/non-existent target (target.length === 0 short-circuit, unaffected by the fallback branch)", () => {
    const $ = cheerio.load(`<div id="other"></div>`);
    const target = $("#does-not-exist");
    expect(discoverUrl($, target)).toBe("");
  });

  test("a single non-boring absolute URL with no preceding boring URL is still found via the same fallback branch", () => {
    const $ = cheerio.load(`<div id="target">Just https://example.com/only.jpg here.</div>`);
    const target = $("#target");
    expect(discoverUrl($, target)).toBe("https://example.com/only.jpg");
  });
});

import { describe, expect, test } from "bun:test";
import { parseExistingFeedContent } from "../utilities/existing-feed-parser.utility";

// ---------------------------------------------------------------------------
// Specifies the maintained-XML-parser behavior contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 1:
// "Existing feed parsing remains behavior-compatible for RSS/Atom inputs,
// rejects or safely handles malformed XML, and does not expand external
// entities or turn hostile declarations into file/network reads. Do not
// weaken parser tests to accept silent data corruption."
//
// This exercises `parseExistingFeedContent` (the same public boundary
// `tests/existing-feed-parser.test.ts` covers for the happy path) rather
// than reaching into xmldom/@xmldom/xmldom internals, so it stays valid
// across the package swap this slice performs.
// ---------------------------------------------------------------------------

describe("ordinary RSS/Atom parsing remains behavior-compatible (regression lock)", () => {
  test("parses RSS item content wrapped in CDATA and a typed enclosure", () => {
    const parsed = parseExistingFeedContent({
      url: "https://example.com/rss.xml",
      format: "auto",
      content: `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>Cast</title><link>https://example.com/1</link><guid>1</guid><description><![CDATA[<b>rich</b> text & more]]></description><enclosure url="https://example.com/a.mp3" type="audio/mpeg" length="1024"/></item></channel></rss>`,
    });
    expect(parsed.detectedFormat).toBe("rss");
    expect(parsed.items[0].description).toContain("rich");
    expect(parsed.items[0].enclosure?.url).toBe("https://example.com/a.mp3");
    expect(parsed.items[0].enclosure?.length).toBe(1024);
    // Anti-bypass: a parser that unconditionally pushes a benign-sounding
    // warning on every call (e.g. "parsed with @xmldom/xmldom") would still
    // satisfy the malformed-input tests below if those tests only checked
    // "warnings is non-empty". Pinning well-formed input to *zero* warnings
    // closes that loophole regardless of what wording such a warning uses.
    expect(parsed.warnings, JSON.stringify(parsed.warnings)).toEqual([]);
  });

  test("parses multiple Atom entries with distinct ids and links", () => {
    const parsed = parseExistingFeedContent({
      url: "https://example.com/atom.xml",
      format: "auto",
      content: `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>a1</id><title>One</title><link href="https://example.com/a1"/><updated>2024-01-01T00:00:00Z</updated></entry><entry><id>a2</id><title>Two</title><link href="https://example.com/a2"/><updated>2024-01-02T00:00:00Z</updated></entry></feed>`,
    });
    expect(parsed.items.length).toBe(2);
    expect(parsed.items.map((i) => i.guid)).toEqual(["a1", "a2"]);
    expect(parsed.items.map((i) => i.link)).toEqual(["https://example.com/a1", "https://example.com/a2"]);
    expect(parsed.warnings, JSON.stringify(parsed.warnings)).toEqual([]);
  });
});

/**
 * True when `warning` actually identifies a parse/malformation problem,
 * rather than being a generic, always-could-be-emitted message (e.g. a
 * library-attribution note). Deliberately paired with the "well-formed input
 * produces zero warnings" regression lock above: that lock is what actually
 * closes the "warn unconditionally on every call" loophole (any non-empty
 * warning on malformed input is automatically distinguishable from the empty
 * array a valid document must produce), so this predicate only needs to rule
 * out an empty/placeholder message, not out-think an adversarial wording.
 */
function identifiesParseProblem(warning: string): boolean {
  if (warning.trim().length < 8) return false;
  return /(pars|malform|invalid|unclosed|truncat|unexpected|syntax|well-form|fatal)/i.test(warning);
}

describe("identifiesParseProblem helper correctness", () => {
  test("accepts a warning that names the parse failure", () => {
    expect(identifiesParseProblem("XML parse error: unclosed tag at line 3")).toBe(true);
    expect(identifiesParseProblem("document is not well-formed: unexpected end of input")).toBe(true);
  });

  test("rejects an empty or trivially short warning", () => {
    expect(identifiesParseProblem("")).toBe(false);
    expect(identifiesParseProblem("!!")).toBe(false);
  });

  test("a generic library-attribution message happens to keyword-match too - by design this predicate is not the sole defense", () => {
    // "parsed with @xmldom/xmldom" contains "pars", so it matches. That is
    // fine: the well-formed regression tests above (asserting zero warnings)
    // are what actually rules out an unconditional always-on warning, not
    // this predicate. This predicate only needs to reject an empty/trivial
    // message on the malformed side - see the doc comment above.
    expect(identifiesParseProblem("parsed with @xmldom/xmldom")).toBe(true);
  });

  test("rejects a warning about something other than parsing (e.g. a network/config notice)", () => {
    expect(identifiesParseProblem("using cached feed metadata")).toBe(false);
  });
});

describe("malformed XML input is rejected or safely handled, never silently corrupted (requirement 1)", () => {
  test("a mismatched/unclosed tag does not silently yield a successful, wrong parse", () => {
    const malformed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Bad</channel></rss>`;
    let threw = false;
    let result: ReturnType<typeof parseExistingFeedContent> | undefined;
    try {
      result = parseExistingFeedContent({ url: "https://example.com/bad.xml", format: "rss", content: malformed });
    } catch {
      threw = true;
    }
    // Acceptable per the brief: either reject the malformed document outright
    // (throw), or accept it while surfacing the malformed condition via a
    // `warnings` entry that actually identifies the problem - but silently
    // returning a clean-looking result with no trace of the problem is
    // exactly the "silent data corruption" the brief forbids.
    const warnings = result?.warnings ?? [];
    const surfacedProblem = threw || warnings.some(identifiesParseProblem);
    expect(
      surfacedProblem,
      `malformed XML must either throw or populate warnings with a message identifying the parse failure; threw=${threw}, warnings=${JSON.stringify(warnings)}`,
    ).toBe(true);
  });

  test("truncated XML (abrupt end-of-input mid-element) does not silently yield a successful, wrong parse", () => {
    const truncated = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Cut off mid`;
    let threw = false;
    let result: ReturnType<typeof parseExistingFeedContent> | undefined;
    try {
      result = parseExistingFeedContent({ url: "https://example.com/truncated.xml", format: "rss", content: truncated });
    } catch {
      threw = true;
    }
    const warnings = result?.warnings ?? [];
    const surfacedProblem = threw || warnings.some(identifiesParseProblem);
    expect(
      surfacedProblem,
      `truncated XML must either throw or populate warnings with a message identifying the parse failure; threw=${threw}, warnings=${JSON.stringify(warnings)}`,
    ).toBe(true);
  });

  test("empty content is rejected rather than producing a phantom feed", () => {
    expect(() =>
      parseExistingFeedContent({ url: "https://example.com/empty.xml", format: "rss", content: "" }),
    ).toThrow();
  });
});

describe("hostile DOCTYPE/entity declarations never turn into file or network reads (requirement 1 security boundary)", () => {
  test("a classic file-disclosure XXE payload does not leak local file content into a parsed field", async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss version="2.0"><channel><item><title>&xxe;</title><guid>1</guid></channel></rss>`;
    let title = "";
    try {
      const result = parseExistingFeedContent({ url: "https://example.com/xxe.xml", format: "rss", content: xxe });
      title = result.items[0]?.title ?? "";
    } catch {
      // Rejecting the payload outright is an acceptable safe outcome too.
    }
    expect(title).not.toContain("root:");
    expect(title).not.toMatch(/\/bin\/(ba)?sh/);
  });

  test("an SSRF-style external SYSTEM DOCTYPE URL is never dereferenced over the network (bounded, no hang)", async () => {
    // 10.255.255.1 is a non-routable, non-local address chosen so that if the
    // parser DID attempt to dereference it, the attempt would hang rather
    // than fail fast - making a tight wall-clock bound a meaningful proof
    // that no such dereference occurred, without needing to mock the network.
    const ssrf = `<?xml version="1.0"?><!DOCTYPE rss SYSTEM "http://10.255.255.1/xxe-probe"><rss version="2.0"><channel><title>T</title></channel></rss>`;
    const start = Date.now();
    try {
      parseExistingFeedContent({ url: "https://example.com/ssrf.xml", format: "rss", content: ssrf });
    } catch {
      // Rejecting the payload outright is an acceptable safe outcome too.
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test("recursive internal entity expansion ('billion laughs' shape) does not hang or blow up memory (bounded failure)", () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE rss [
      <!ENTITY a0 "expand">
      <!ENTITY a1 "&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;&a0;">
      <!ENTITY a2 "&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;&a1;">
      <!ENTITY a3 "&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;&a2;">
      <!ENTITY a4 "&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;&a3;">
    ]><rss version="2.0"><channel><title>&a4;</title></channel></rss>`;
    const start = Date.now();
    try {
      parseExistingFeedContent({ url: "https://example.com/laughs.xml", format: "rss", content: laughs });
    } catch {
      // Rejecting the payload outright is an acceptable safe outcome too.
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

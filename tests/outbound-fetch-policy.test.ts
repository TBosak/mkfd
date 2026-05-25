import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// We need to mock dns before importing the module under test
// Use Bun's module mock to replace the dns module
import * as dns from "node:dns/promises";

import {
  parseAllowlist,
  isBlockedAddress,
  assertOutboundFetchAllowed,
} from "../utilities/outbound-fetch-policy.utility";

// ──────────────────────────────────────────────────────────────────────────────
// parseAllowlist
// ──────────────────────────────────────────────────────────────────────────────

describe("parseAllowlist", () => {
  it("returns empty array for empty string", () => {
    expect(parseAllowlist("")).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("parses single entry", () => {
    expect(parseAllowlist("nas.local")).toEqual(["nas.local"]);
  });

  it("parses comma-separated entries", () => {
    expect(parseAllowlist("nas.local,10.0.0.5")).toEqual([
      "nas.local",
      "10.0.0.5",
    ]);
  });

  it("trims whitespace from entries", () => {
    expect(parseAllowlist("  nas.local , 10.0.0.5  ")).toEqual([
      "nas.local",
      "10.0.0.5",
    ]);
  });

  it("lowercases entries", () => {
    expect(parseAllowlist("NAS.LOCAL,MyHost")).toEqual([
      "nas.local",
      "myhost",
    ]);
  });

  it("filters out empty entries after trimming", () => {
    expect(parseAllowlist("nas.local,,10.0.0.5")).toEqual([
      "nas.local",
      "10.0.0.5",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isBlockedAddress
// ──────────────────────────────────────────────────────────────────────────────

describe("isBlockedAddress — IPv4 loopback", () => {
  it("blocks 127.0.0.1", () => expect(isBlockedAddress("127.0.0.1")).toBe(true));
  it("blocks 127.255.255.255", () => expect(isBlockedAddress("127.255.255.255")).toBe(true));
  it("blocks 127.0.0.100", () => expect(isBlockedAddress("127.0.0.100")).toBe(true));
});

describe("isBlockedAddress — IPv4 private RFC1918", () => {
  it("blocks 10.0.0.1", () => expect(isBlockedAddress("10.0.0.1")).toBe(true));
  it("blocks 10.255.255.255", () => expect(isBlockedAddress("10.255.255.255")).toBe(true));
  it("blocks 172.16.0.1", () => expect(isBlockedAddress("172.16.0.1")).toBe(true));
  it("blocks 172.31.255.255", () => expect(isBlockedAddress("172.31.255.255")).toBe(true));
  it("blocks 192.168.0.1", () => expect(isBlockedAddress("192.168.0.1")).toBe(true));
  it("blocks 192.168.255.255", () => expect(isBlockedAddress("192.168.255.255")).toBe(true));
});

describe("isBlockedAddress — IPv4 link-local", () => {
  it("blocks 169.254.0.1", () => expect(isBlockedAddress("169.254.0.1")).toBe(true));
  it("blocks 169.254.169.254 (AWS/GCP metadata)", () => expect(isBlockedAddress("169.254.169.254")).toBe(true));
  it("blocks 169.254.255.255", () => expect(isBlockedAddress("169.254.255.255")).toBe(true));
});

describe("isBlockedAddress — IPv4 other reserved", () => {
  it("blocks 0.0.0.0", () => expect(isBlockedAddress("0.0.0.0")).toBe(true));
  it("blocks 0.255.255.255", () => expect(isBlockedAddress("0.255.255.255")).toBe(true));
  it("blocks 100.64.0.1 (CGNAT)", () => expect(isBlockedAddress("100.64.0.1")).toBe(true));
  it("blocks 100.127.255.255 (CGNAT)", () => expect(isBlockedAddress("100.127.255.255")).toBe(true));
  it("blocks 192.0.0.1", () => expect(isBlockedAddress("192.0.0.1")).toBe(true));
  it("blocks 198.18.0.1", () => expect(isBlockedAddress("198.18.0.1")).toBe(true));
  it("blocks 198.19.255.255", () => expect(isBlockedAddress("198.19.255.255")).toBe(true));
  it("blocks 198.51.100.1 (TEST-NET-2)", () => expect(isBlockedAddress("198.51.100.1")).toBe(true));
  it("blocks 203.0.113.1 (TEST-NET-3)", () => expect(isBlockedAddress("203.0.113.1")).toBe(true));
  it("blocks 240.0.0.1 (reserved)", () => expect(isBlockedAddress("240.0.0.1")).toBe(true));
  it("blocks 255.255.255.255", () => expect(isBlockedAddress("255.255.255.255")).toBe(true));
});

describe("isBlockedAddress — IPv4 multicast", () => {
  it("blocks 224.0.0.1", () => expect(isBlockedAddress("224.0.0.1")).toBe(true));
  it("blocks 239.255.255.255", () => expect(isBlockedAddress("239.255.255.255")).toBe(true));
});

describe("isBlockedAddress — public IPv4", () => {
  it("allows 8.8.8.8", () => expect(isBlockedAddress("8.8.8.8")).toBe(false));
  it("allows 1.1.1.1", () => expect(isBlockedAddress("1.1.1.1")).toBe(false));
  it("allows 93.184.216.34 (example.com)", () => expect(isBlockedAddress("93.184.216.34")).toBe(false));
  it("allows 172.15.255.255 (just outside 172.16.0.0/12)", () => expect(isBlockedAddress("172.15.255.255")).toBe(false));
  it("allows 172.32.0.0 (just outside 172.16.0.0/12)", () => expect(isBlockedAddress("172.32.0.0")).toBe(false));
});

describe("isBlockedAddress — IPv6 loopback", () => {
  it("blocks ::1", () => expect(isBlockedAddress("::1")).toBe(true));
});

describe("isBlockedAddress — IPv6 ULA (fc00::/7)", () => {
  it("blocks fc00::1", () => expect(isBlockedAddress("fc00::1")).toBe(true));
  it("blocks fd00::1", () => expect(isBlockedAddress("fd00::1")).toBe(true));
  it("blocks fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", () =>
    expect(isBlockedAddress("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true));
});

describe("isBlockedAddress — IPv6 link-local (fe80::/10)", () => {
  it("blocks fe80::1", () => expect(isBlockedAddress("fe80::1")).toBe(true));
  it("blocks febf::1", () => expect(isBlockedAddress("febf::1")).toBe(true));
});

describe("isBlockedAddress — IPv6 other", () => {
  it("blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)", () =>
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true));
  it("blocks ::ffff:10.0.0.1 (IPv4-mapped private)", () =>
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true));
  it("blocks ::ffff:192.168.1.1 (IPv4-mapped private)", () =>
    expect(isBlockedAddress("::ffff:192.168.1.1")).toBe(true));
  it("blocks 2001:db8::1 (documentation)", () =>
    expect(isBlockedAddress("2001:db8::1")).toBe(true));
  it("blocks 100::1 (discard)", () =>
    expect(isBlockedAddress("100::1")).toBe(true));
  it("blocks 2001::1 (Teredo)", () =>
    expect(isBlockedAddress("2001::1")).toBe(true));
  it("blocks 2002::1 (6to4)", () =>
    expect(isBlockedAddress("2002::1")).toBe(true));
});

describe("isBlockedAddress — public IPv6", () => {
  it("allows 2606:4700::1111 (Cloudflare DNS)", () =>
    expect(isBlockedAddress("2606:4700::1111")).toBe(false));
  it("allows 2001:4860:4860::8888 (Google public DNS — not Teredo)", () =>
    // Teredo is 2001:0000::/32 (second 16-bit group = 0x0000).
    // Google's 2001:4860:: has second group 0x4860, so it is NOT in the Teredo range.
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false));
});

// ──────────────────────────────────────────────────────────────────────────────
// assertOutboundFetchAllowed
// ──────────────────────────────────────────────────────────────────────────────

describe("assertOutboundFetchAllowed — scheme checks", () => {
  it("allows http scheme", async () => {
    // Use a known-blocked IP so no DNS needed — but we allow it via allowlist
    await expect(
      assertOutboundFetchAllowed("http://8.8.8.8/foo", {
        allowPrivateFetches: false,
        allowlist: [],
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("allows https scheme", async () => {
    await expect(
      assertOutboundFetchAllowed("https://8.8.8.8/foo", {
        allowPrivateFetches: false,
        allowlist: [],
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects file: scheme", async () => {
    await expect(
      assertOutboundFetchAllowed("file:///etc/passwd")
    ).rejects.toThrow(/scheme/i);
  });

  it("rejects ftp: scheme", async () => {
    await expect(
      assertOutboundFetchAllowed("ftp://example.com/file")
    ).rejects.toThrow(/scheme/i);
  });

  it("rejects javascript: scheme", async () => {
    await expect(
      assertOutboundFetchAllowed("javascript:alert(1)")
    ).rejects.toThrow(/scheme/i);
  });

  it("rejects data: scheme", async () => {
    await expect(
      assertOutboundFetchAllowed("data:text/plain,hello")
    ).rejects.toThrow(/scheme/i);
  });

  it("throws on unparseable URL", async () => {
    await expect(
      assertOutboundFetchAllowed("not-a-url")
    ).rejects.toThrow();
  });
});

describe("assertOutboundFetchAllowed — literal IP blocking (no DNS needed)", () => {
  it("blocks literal 127.0.0.1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://127.0.0.1/foo")
    ).rejects.toThrow(/blocked|private|loopback/i);
  });

  it("blocks literal ::1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://[::1]/foo")
    ).rejects.toThrow(/blocked|private|loopback/i);
  });

  it("blocks literal 169.254.169.254", async () => {
    await expect(
      assertOutboundFetchAllowed("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/blocked|private|loopback|link.local/i);
  });

  it("blocks literal 10.0.0.1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://10.0.0.1/internal")
    ).rejects.toThrow(/blocked|private/i);
  });

  it("blocks literal 172.16.0.1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://172.16.0.1/internal")
    ).rejects.toThrow(/blocked|private/i);
  });

  it("blocks literal 192.168.0.1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://192.168.0.1/internal")
    ).rejects.toThrow(/blocked|private/i);
  });

  it("blocks literal fc00::1", async () => {
    await expect(
      assertOutboundFetchAllowed("http://[fc00::1]/internal")
    ).rejects.toThrow(/blocked|private/i);
  });
});

describe("assertOutboundFetchAllowed — metadata hostname blocking", () => {
  it("blocks 169.254.169.254 as hostname", async () => {
    await expect(
      assertOutboundFetchAllowed("http://169.254.169.254/")
    ).rejects.toThrow();
  });

  it("blocks metadata.google.internal", async () => {
    await expect(
      assertOutboundFetchAllowed("http://metadata.google.internal/computeMetadata/v1/")
    ).rejects.toThrow(/metadata|blocked/i);
  });

  it("blocks metadata.google.com", async () => {
    await expect(
      assertOutboundFetchAllowed("http://metadata.google.com/computeMetadata/v1/")
    ).rejects.toThrow(/metadata|blocked/i);
  });

  it("blocks computemetadata.v1.internal", async () => {
    await expect(
      assertOutboundFetchAllowed("http://computemetadata.v1.internal/")
    ).rejects.toThrow(/metadata|blocked/i);
  });
});

describe("assertOutboundFetchAllowed — allowPrivateFetches override", () => {
  it("allows 192.168.0.1 when allowPrivateFetches is true", async () => {
    await expect(
      assertOutboundFetchAllowed("http://192.168.0.1/feed", {
        allowPrivateFetches: true,
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("allows 10.0.0.5 when allowPrivateFetches is true", async () => {
    await expect(
      assertOutboundFetchAllowed("http://10.0.0.5/feed", {
        allowPrivateFetches: true,
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("does NOT allow metadata host even with allowPrivateFetches", async () => {
    await expect(
      assertOutboundFetchAllowed("http://169.254.169.254/latest", {
        allowPrivateFetches: true,
        _skipDns: true,
      })
    ).rejects.toThrow();
  });

  it("does NOT allow metadata.google.internal even with allowPrivateFetches", async () => {
    await expect(
      assertOutboundFetchAllowed("http://metadata.google.internal/", {
        allowPrivateFetches: true,
        _skipDns: true,
      })
    ).rejects.toThrow(/metadata|blocked/i);
  });
});

describe("assertOutboundFetchAllowed — allowlist", () => {
  it("allows a host that is on the allowlist even if it resolves to a private IP", async () => {
    // nas.local is on the allowlist, skip DNS
    await expect(
      assertOutboundFetchAllowed("http://nas.local/feed", {
        allowlist: ["nas.local"],
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("allows a literal private IP that is on the allowlist", async () => {
    await expect(
      assertOutboundFetchAllowed("http://10.0.0.5/feed", {
        allowlist: ["10.0.0.5"],
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });

  it("blocks a host that is NOT on the allowlist", async () => {
    await expect(
      assertOutboundFetchAllowed("http://10.0.0.5/feed", {
        allowlist: ["10.0.0.6"],
        _skipDns: true,
      })
    ).rejects.toThrow(/blocked|private/i);
  });

  it("does NOT allow metadata host even if on allowlist", async () => {
    await expect(
      assertOutboundFetchAllowed("http://metadata.google.internal/", {
        allowlist: ["metadata.google.internal"],
        _skipDns: true,
      })
    ).rejects.toThrow(/metadata|blocked/i);
  });

  it("allowlist matching is case-insensitive", async () => {
    await expect(
      assertOutboundFetchAllowed("http://NAS.LOCAL/feed", {
        allowlist: ["nas.local"],
        _skipDns: true,
      })
    ).resolves.toBeUndefined();
  });
});

describe("assertOutboundFetchAllowed — DNS resolution blocking", () => {
  it("blocks a hostname whose DNS resolves to a private IP", async () => {
    // We use a fake hostname and provide dns mock via _dnsLookupFn override
    await expect(
      assertOutboundFetchAllowed("http://internal.example.local/feed", {
        _dnsLookupFn: async (_hostname: string) => ["10.0.0.1"],
      })
    ).rejects.toThrow(/blocked|private/i);
  });

  it("allows a hostname whose DNS resolves to a public IP", async () => {
    await expect(
      assertOutboundFetchAllowed("http://example.com/feed", {
        _dnsLookupFn: async (_hostname: string) => ["93.184.216.34"],
      })
    ).resolves.toBeUndefined();
  });

  it("blocks when any resolved address is private (even if others are public)", async () => {
    await expect(
      assertOutboundFetchAllowed("http://mixed.example.com/feed", {
        _dnsLookupFn: async (_hostname: string) => ["93.184.216.34", "10.0.0.1"],
      })
    ).rejects.toThrow(/blocked|private/i);
  });

  it("allows when allowPrivateFetches=true and DNS resolves private", async () => {
    await expect(
      assertOutboundFetchAllowed("http://internal.example.local/feed", {
        allowPrivateFetches: true,
        _dnsLookupFn: async (_hostname: string) => ["10.0.0.1"],
      })
    ).resolves.toBeUndefined();
  });

  it("skips DNS when host is on allowlist", async () => {
    let dnsCalled = false;
    await expect(
      assertOutboundFetchAllowed("http://nas.local/feed", {
        allowlist: ["nas.local"],
        _dnsLookupFn: async (_hostname: string) => {
          dnsCalled = true;
          return ["10.0.0.5"];
        },
      })
    ).resolves.toBeUndefined();
    expect(dnsCalled).toBe(false);
  });

  it("throws (fail-closed) when _dnsLookupFn rejects", async () => {
    // DNS failures must block the request, not silently allow it
    await expect(
      assertOutboundFetchAllowed("http://unknown.example.com/feed", {
        _dnsLookupFn: async (_hostname: string) => {
          throw new Error("ENOTFOUND unknown.example.com");
        },
      })
    ).rejects.toThrow();
  });
});

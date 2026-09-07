// TDD slice: p3-shared-outbound-executor
//
// Specifies the roadmap Packet 3 "outbound HTTP(S) executor" bullet and its
// exit criterion ("no user-controlled URL sink bypasses the shared
// executor"). Audit findings S3/S4/S6.
//
// Design assumption this file makes, per the brief's request to flag rather
// than guess: the "one exported executor" is `executeWithFetchPolicy` in
// `utilities/fetch-policy.utility.ts`, extended in place rather than
// replaced by a brand-new module. That function already owns the run
// deadline, `maxRedirects`, `maxContentLength`/`maxBodyLength`, and an
// `attempts` metadata array — it is the closest thing this repo has today to
// "the one exported executor", and the brief explicitly asks to build on the
// existing two modules rather than rewriting their logic. If the lead
// decides instead to introduce a new module (or to rename this export),
// only the import path/name below needs to change — the behavioral
// specification in each test does not depend on the module's name.
//
// These tests exercise real local HTTP servers on ephemeral 127.0.0.1 ports
// (never the internet) for every network-observable property (TOCTOU
// address pinning, redirect revalidation, byte caps, total deadline), and
// use the existing `_dnsLookupFn` seam from
// `utilities/outbound-fetch-policy.utility.ts` to control DNS resolution
// deterministically, exactly as the brief suggests. No test resolves or
// connects to a real third-party host.
//
// Redirect targets that must be REFUSED are deliberately chosen to be
// impossible to reach even if the refusal doesn't happen: literal loopback
// addresses that are never bound to a listener (self-contained, cannot
// leave the machine, fail instantly if a naive implementation tries to
// connect), a hostname reserved by RFC 2606 to never resolve
// (`*.invalid`), and the absolute cloud-metadata hostname block, which
// `assertOutboundFetchAllowed` rejects by a synchronous string comparison
// before any DNS or socket activity — never a live metadata IP literal.

import { afterEach, describe, expect, test } from "bun:test";
import * as http from "node:http";
import * as zlib from "node:zlib";
import { executeWithFetchPolicy } from "../utilities/fetch-policy.utility";

// ---------------------------------------------------------------------------
// Local server helpers — every server binds to 127.0.0.x on an ephemeral
// port and is torn down after each test.
// ---------------------------------------------------------------------------

type BunServerHandle = { url: string; port: number; hostname: string; stop: () => void };

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) {
    const stop = cleanups.pop();
    try {
      stop?.();
    } catch {
      // best-effort teardown
    }
  }
});

function startBunServer(
  hostname: string,
  fetchHandler: (req: Request) => Response | Promise<Response>,
): BunServerHandle {
  const server = Bun.serve({ hostname, port: 0, fetch: fetchHandler });
  cleanups.push(() => server.stop(true));
  return {
    url: `http://${hostname}:${server.port}`,
    port: server.port,
    hostname,
    stop: () => server.stop(true),
  };
}

function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; port: number; requestCount: () => number }> {
  return new Promise((resolve) => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount++;
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      cleanups.push(() => server.close());
      resolve({ url: `http://127.0.0.1:${port}`, port, requestCount: () => requestCount });
    });
  });
}

// ---------------------------------------------------------------------------
// Requirement 2 — the connection goes to the validated address (TOCTOU),
// and the original hostname survives as the Host header.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — connects to the address that was validated, not a freshly re-resolved one (requirement 2)", () => {
  test(
    "a hostname that only resolves through the injected resolver (never real DNS) still reaches the validated server, with the original hostname preserved as the Host header",
    async () => {
      // "toctou-pin.mkfd.invalid" is reserved by RFC 2606 to never resolve in
      // real DNS. If the implementation re-resolves the hostname itself
      // (today's defect) instead of connecting to the address it already
      // validated via _dnsLookupFn, the request can only fail with a real
      // DNS error — it can never legitimately reach this server.
      const hostname = "toctou-pin.mkfd.invalid";
      let seenHost: string | undefined;
      const serverA = startBunServer("127.0.0.1", (req) => {
        seenHost = req.headers.get("host") ?? undefined;
        return new Response("MARKER_SERVER_A");
      });

      const result = await executeWithFetchPolicy<string>({
        url: `http://${hostname}:${serverA.port}/path`,
        outboundPolicy: {
          allowPrivateFetches: true, // isolates pinning from the private-range block, already covered elsewhere
          _dnsLookupFn: async () => ["127.0.0.1"],
        },
      });

      expect(result.data).toBe("MARKER_SERVER_A");
      expect(seenHost).toBe(`${hostname}:${serverA.port}`);
    },
    10_000,
  );

  test(
    "a second, different address returned by a later resolver call is never reached (classic DNS-rebinding shape)",
    async () => {
      const hostname = "toctou-rebind.mkfd.invalid";
      let serverBRequests = 0;
      const serverA = startBunServer("127.0.0.1", () => new Response("MARKER_SERVER_A"));
      startBunServer("127.0.0.2", () => {
        serverBRequests++;
        return new Response("MARKER_SERVER_B");
      });

      let lookupCalls = 0;
      const result = await executeWithFetchPolicy<string>({
        url: `http://${hostname}:${serverA.port}/path`,
        outboundPolicy: {
          allowPrivateFetches: true,
          _dnsLookupFn: async () => {
            lookupCalls++;
            // First lookup (the one used to validate the request) returns
            // Server A's address. Any later lookup — the shape a DNS
            // rebinding attacker relies on — returns Server B's instead.
            return lookupCalls === 1 ? ["127.0.0.1"] : ["127.0.0.2"];
          },
        },
      });

      expect(result.data).toBe("MARKER_SERVER_A");
      expect(serverBRequests).toBe(0);
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// Requirement 3 — every redirect hop is revalidated, not merely counted.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — revalidates every redirect hop against the full policy, not only the first URL (requirement 3)", () => {
  test("a second hop that lands on a private address introduced only by the redirect is refused, even though a real server is listening there and would happily respond", async () => {
    // Hop 1 (127.0.0.1) is explicitly allowlisted so it passes validation.
    // Hop 2 (127.0.0.2) is a different literal address, not on the
    // allowlist, and is itself a real, listening, loopback-only server —
    // if the redirect isn't revalidated, this test observes the leak
    // directly (the response body becomes hop 2's secret marker) rather
    // than merely a generic error.
    let hop2Requests = 0;
    const hop2 = startBunServer("127.0.0.2", () => {
      hop2Requests++;
      return new Response("LEAKED_FROM_HOP_2");
    });
    const hop1 = startBunServer("127.0.0.1", () => {
      return new Response(null, {
        status: 302,
        headers: { location: `http://127.0.0.2:${hop2.port}/secret` },
      });
    });

    await expect(
      executeWithFetchPolicy<string>({
        url: `${hop1.url}/start`,
        outboundPolicy: { allowlist: ["127.0.0.1"] },
      }),
    ).rejects.toThrow(/blocked|private|reserved/i);
    expect(hop2Requests).toBe(0);
  });

  test("a redirect to the absolute cloud-metadata hostname is refused at the hop that introduces it, even though the initial host is allowlisted", async () => {
    // metadata.google.internal is rejected by a synchronous hostname
    // string comparison in assertOutboundFetchAllowed, before any DNS
    // lookup or socket activity — asserting this is safe in any
    // environment, including a real cloud host where that name might
    // otherwise resolve to a live metadata service.
    const hop1 = startBunServer("127.0.0.1", () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://metadata.google.internal/latest/meta-data/" },
      });
    });

    await expect(
      executeWithFetchPolicy<string>({
        url: `${hop1.url}/start`,
        outboundPolicy: { allowlist: ["127.0.0.1"], allowPrivateFetches: true },
      }),
    ).rejects.toThrow(/metadata|blocked/i);
  });

  test("a redirect to a non-http(s) scheme is refused at the hop that introduces it", async () => {
    const hop1 = startBunServer("127.0.0.1", () => {
      return new Response(null, {
        status: 302,
        headers: { location: "file:///etc/passwd" },
      });
    });

    await expect(
      executeWithFetchPolicy<string>({
        url: `${hop1.url}/start`,
        outboundPolicy: { allowlist: ["127.0.0.1"], allowPrivateFetches: true },
      }),
    ).rejects.toThrow(/scheme/i);
  });

  test("sanity: a redirect to an allowed address still succeeds (the revalidation isn't just refusing everything)", async () => {
    const hop2 = startBunServer("127.0.0.1", () => new Response("FINAL_OK"));
    const hop1 = startBunServer("127.0.0.1", () => {
      return new Response(null, {
        status: 302,
        headers: { location: `${hop2.url}/final` },
      });
    });

    const result = await executeWithFetchPolicy<string>({
      url: `${hop1.url}/start`,
      outboundPolicy: { allowlist: ["127.0.0.1"] },
    });
    expect(result.data).toBe("FINAL_OK");
  });
});

// ---------------------------------------------------------------------------
// Requirement 4 — both compressed and decompressed sizes are bounded, and
// exceeding either cuts the transfer off rather than buffering it whole.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — bounds both the compressed and decompressed response size (requirement 4)", () => {
  test(
    "a response with no declared length that keeps streaming past the size cap is cut off, not buffered in full",
    async () => {
      const CAP = 4096;
      const server = await startHttpServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        // Stream far more than the cap, in small chunks, and never
        // voluntarily stop — a correct implementation must abort the
        // socket once the cap is crossed rather than waiting for `end`.
        const chunk = Buffer.alloc(4096, 97);
        let sent = 0;
        const interval = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(interval);
            return;
          }
          res.write(chunk);
          sent += chunk.length;
          if (sent > 50 * 1024 * 1024) {
            clearInterval(interval);
            res.end();
          }
        }, 1);
      });

      const startedAt = Date.now();
      await expect(
        executeWithFetchPolicy<string>({
          url: `${server.url}/big`,
          outboundPolicy: { allowPrivateFetches: true },
          policy: { maxResponseSizeBytes: CAP },
        }),
      ).rejects.toThrow(/size|length|limit|large/i);
      // Proves early termination rather than draining the (effectively
      // unbounded) stream: the whole exchange must finish in well under
      // the time it would take to stream tens of megabytes at 4KB/ms.
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    },
    10_000,
  );

  test(
    "a gzip-compressed response that decompresses far past the size cap is rejected, even though the compressed bytes on the wire are tiny",
    async () => {
      const CAP = 200 * 1024;
      const decompressedBomb = Buffer.alloc(50 * 1024 * 1024, 97); // 50MB of 'a'
      const compressed = zlib.gzipSync(decompressedBomb);
      // Highly compressible payload: the compressed form is well under the
      // cap even though the decompressed form is ~1,000x larger.
      expect(compressed.length).toBeLessThan(CAP);

      const server = await startHttpServer((_req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "gzip",
          "Content-Length": String(compressed.length),
        });
        res.end(compressed);
      });

      await expect(
        executeWithFetchPolicy<string>({
          url: `${server.url}/bomb`,
          outboundPolicy: { allowPrivateFetches: true },
          policy: { maxResponseSizeBytes: CAP },
        }),
      ).rejects.toThrow(/size|length|limit|large/i);
    },
    10_000,
  );

  test("sanity: a small, ordinary response under the cap still succeeds", async () => {
    const server = await startHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("small body");
    });
    const result = await executeWithFetchPolicy<string>({
      url: `${server.url}/small`,
      outboundPolicy: { allowPrivateFetches: true },
      policy: { maxResponseSizeBytes: 4096 },
    });
    expect(result.data).toBe("small body");
  });
});

// ---------------------------------------------------------------------------
// Requirement 5 — one total deadline covers DNS, connection, every redirect
// hop, and the body read, not a per-hop timeout a redirect chain can
// multiply.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — enforces one total deadline across the whole operation, not a per-hop budget (requirement 5)", () => {
  test(
    "two redirect hops that are each individually fast enough, but whose sum exceeds the total deadline, are rejected for exceeding the deadline",
    async () => {
      const HOP_DELAY_MS = 220;
      const TOTAL_DEADLINE_MS = 300;

      const hop2 = startBunServer("127.0.0.1", async () => {
        await new Promise((r) => setTimeout(r, HOP_DELAY_MS));
        return new Response("TOO_LATE");
      });
      const hop1 = startBunServer("127.0.0.1", async () => {
        await new Promise((r) => setTimeout(r, HOP_DELAY_MS));
        return new Response(null, {
          status: 302,
          headers: { location: `${hop2.url}/final` },
        });
      });

      const startedAt = Date.now();
      await expect(
        executeWithFetchPolicy<string>({
          url: `${hop1.url}/start`,
          outboundPolicy: { allowlist: ["127.0.0.1"] },
          policy: { feedRunTimeoutMs: TOTAL_DEADLINE_MS },
        }),
      ).rejects.toThrow(/deadline|timeout|exceeded/i);
      const elapsed = Date.now() - startedAt;
      // A per-hop (rather than total) timeout of TOTAL_DEADLINE_MS would let
      // this chain run for roughly 2x HOP_DELAY_MS before failing on hop 2's
      // own budget. The total-deadline requirement means it must instead
      // stop close to TOTAL_DEADLINE_MS, well before both hops complete.
      expect(elapsed).toBeLessThan(HOP_DELAY_MS * 2);
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// Requirement 6 / anti-bypass — credentials in a URL are refused outright,
// and no credential or userinfo ever appears in the returned/thrown
// diagnostics, even when reporting exactly that refusal.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — a credentialed URL is refused outright, and never leaks the credential while reporting it (requirement 6, anti-bypass)", () => {
  test("a credentialed URL to an otherwise-allowlisted host is refused, not silently stripped and followed", async () => {
    let serverRequests = 0;
    const server = startBunServer("127.0.0.1", () => {
      serverRequests++;
      return new Response("SHOULD_NOT_BE_REACHED");
    });

    let caught: unknown;
    try {
      await executeWithFetchPolicy<string>({
        url: `http://attacker:hunter2@127.0.0.1:${server.port}/x`,
        outboundPolicy: { allowlist: ["127.0.0.1"] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught, "a credentialed URL must be refused, not silently followed").toBeDefined();
    expect(serverRequests).toBe(0);
    const message = String((caught as Error)?.message ?? caught);
    expect(message).not.toContain("hunter2");
  });

  test("a redirect that introduces credentials on an otherwise-unreachable-anyway address is refused without leaking the credential in the failure", async () => {
    const hop1 = startBunServer("127.0.0.1", () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://attacker:hunter2@127.0.0.2/x" },
      });
    });

    let caught: unknown;
    try {
      await executeWithFetchPolicy<string>({
        url: `${hop1.url}/start`,
        outboundPolicy: { allowlist: ["127.0.0.1"] },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const message = String((caught as Error)?.message ?? caught);
    expect(message).not.toContain("hunter2");
  });
});

// ---------------------------------------------------------------------------
// Reuse, not duplication — the executor must delegate to the existing SSRF
// policy rather than re-implementing it. A single representative check is
// enough here; the full range matrix is already covered by
// tests/outbound-fetch-policy.test.ts and must not be re-litigated.
// ---------------------------------------------------------------------------

describe("executeWithFetchPolicy — delegates to the existing outbound fetch policy rather than a parallel implementation", () => {
  test("a private literal IP is still refused with the existing policy's wording", async () => {
    await expect(
      executeWithFetchPolicy<string>({ url: "http://10.1.2.3/internal" }),
    ).rejects.toThrow(/blocked|private/i);
  });
});

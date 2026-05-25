/**
 * Outbound Fetch Policy Utility
 *
 * Provides SSRF protection by validating URLs before any outbound fetch.
 * Blocks private/loopback/link-local/reserved ranges and known cloud metadata
 * addresses. Admins can override via ALLOW_PRIVATE_FETCHES=true or
 * OUTBOUND_FETCH_ALLOWLIST=nas.local,10.0.0.5.
 *
 * Migration note: In v1, env vars are the only source of allowPrivateFetches
 * and outboundFetchAllowlist. When Settings Page is implemented, these reads
 * must be replaced with effective settings lookups.
 */

import { resolve4, resolve6 } from "node:dns/promises";
import * as net from "node:net";

// ──────────────────────────────────────────────────────────────────────────────
// Known cloud metadata hostnames — never allowed, even with allowPrivateFetches
// ──────────────────────────────────────────────────────────────────────────────
const METADATA_HOSTNAMES = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google.com",
  "computemetadata.v1.internal",
]);

// ──────────────────────────────────────────────────────────────────────────────
// parseAllowlist
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parses a comma-separated allowlist string into lowercase trimmed entries.
 * Empty entries are filtered out.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// IPv4 helpers
// ──────────────────────────────────────────────────────────────────────────────

function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function inIPv4Range(ip: string, cidrBase: string, prefixLen: number): boolean {
  const ipNum = ipv4ToNumber(ip) >>> 0;
  const baseNum = ipv4ToNumber(cidrBase) >>> 0;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

// ──────────────────────────────────────────────────────────────────────────────
// IPv6 helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Expands an IPv6 address (possibly abbreviated) to its full 16-byte
 * representation as a Uint8Array.
 */
function expandIPv6(addr: string): Uint8Array | null {
  // Handle IPv4-mapped addresses like ::ffff:192.168.1.1
  const ipv4MappedMatch = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    const ipv4Parts = ipv4MappedMatch[1].split(".").map(Number);
    if (ipv4Parts.length !== 4 || ipv4Parts.some((p) => p > 255 || p < 0)) {
      return null;
    }
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes[12] = ipv4Parts[0];
    bytes[13] = ipv4Parts[1];
    bytes[14] = ipv4Parts[2];
    bytes[15] = ipv4Parts[3];
    return bytes;
  }

  // Split on ::
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];

  // Validate group count
  const totalGroups = left.length + right.length;
  if (halves.length === 1 && totalGroups !== 8) return null;
  if (halves.length === 2 && totalGroups > 7) return null;

  const missing = 8 - totalGroups;
  const groups: number[] = [];

  for (const g of left) {
    const v = parseInt(g, 16);
    if (isNaN(v)) return null;
    groups.push(v);
  }
  for (let i = 0; i < missing; i++) {
    groups.push(0);
  }
  for (const g of right) {
    const v = parseInt(g, 16);
    if (isNaN(v)) return null;
    groups.push(v);
  }

  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

function inIPv6Range(addrBytes: Uint8Array, prefixHex: string, prefixLen: number): boolean {
  const prefixBytes = expandIPv6(prefixHex);
  if (!prefixBytes) return false;

  const fullBytes = Math.floor(prefixLen / 8);
  const remainBits = prefixLen % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (addrBytes[i] !== prefixBytes[i]) return false;
  }

  if (remainBits > 0) {
    const mask = (0xff << (8 - remainBits)) & 0xff;
    if ((addrBytes[fullBytes] & mask) !== (prefixBytes[fullBytes] & mask)) {
      return false;
    }
  }

  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// isBlockedAddress
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given IP address falls within a blocked range.
 * Checks IPv4 and IPv6 private, loopback, link-local, reserved, multicast,
 * and known cloud metadata ranges.
 *
 * This is a pure function — no env var reads, no DNS calls.
 */
export function isBlockedAddress(address: string): boolean {
  // Detect address family
  if (net.isIPv4(address)) {
    return isBlockedIPv4(address);
  }

  // Handle ::ffff:x.x.x.x notation (net.isIPv6 returns true for these)
  const ipv4MappedMatch = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    // Block if either the IPv4-mapped form itself is in a blocked IPv6 range
    // OR the embedded IPv4 is blocked
    return isBlockedIPv4(ipv4MappedMatch[1]);
  }

  if (net.isIPv6(address)) {
    return isBlockedIPv6(address);
  }

  // Not a recognized IP format — don't block (hostname handling is elsewhere)
  return false;
}

function isBlockedIPv4(ip: string): boolean {
  // 0.0.0.0/8
  if (inIPv4Range(ip, "0.0.0.0", 8)) return true;
  // 10.0.0.0/8 (private)
  if (inIPv4Range(ip, "10.0.0.0", 8)) return true;
  // 100.64.0.0/10 (CGNAT / shared address space)
  if (inIPv4Range(ip, "100.64.0.0", 10)) return true;
  // 127.0.0.0/8 (loopback)
  if (inIPv4Range(ip, "127.0.0.0", 8)) return true;
  // 169.254.0.0/16 (link-local)
  if (inIPv4Range(ip, "169.254.0.0", 16)) return true;
  // 172.16.0.0/12 (private)
  if (inIPv4Range(ip, "172.16.0.0", 12)) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (inIPv4Range(ip, "192.0.0.0", 24)) return true;
  // 192.168.0.0/16 (private)
  if (inIPv4Range(ip, "192.168.0.0", 16)) return true;
  // 198.18.0.0/15 (benchmarking)
  if (inIPv4Range(ip, "198.18.0.0", 15)) return true;
  // 198.51.100.0/24 (TEST-NET-2 / documentation)
  if (inIPv4Range(ip, "198.51.100.0", 24)) return true;
  // 203.0.113.0/24 (TEST-NET-3 / documentation)
  if (inIPv4Range(ip, "203.0.113.0", 24)) return true;
  // 224.0.0.0/4 (multicast)
  if (inIPv4Range(ip, "224.0.0.0", 4)) return true;
  // 240.0.0.0/4 (reserved for future use)
  if (inIPv4Range(ip, "240.0.0.0", 4)) return true;
  // 255.255.255.255/32 (limited broadcast)
  if (ip === "255.255.255.255") return true;

  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const bytes = expandIPv6(ip);
  if (!bytes) return false;

  // ::1/128 — loopback
  if (ip === "::1") return true;

  // fc00::/7 — Unique Local Addresses (ULA) — covers fc00:: through fdff::
  if (inIPv6Range(bytes, "fc00::", 7)) return true;

  // fe80::/10 — link-local
  if (inIPv6Range(bytes, "fe80::", 10)) return true;

  // ::ffff:0:0/96 — IPv4-mapped (handled by caller in isBlockedAddress,
  // but catch here too for direct calls)
  if (inIPv6Range(bytes, "::ffff:0:0", 96)) return true;

  // 2001:db8::/32 — documentation range
  if (inIPv6Range(bytes, "2001:db8::", 32)) return true;

  // 100::/64 — discard prefix
  if (inIPv6Range(bytes, "100::", 64)) return true;

  // 2001:0000::/32 — Teredo (RFC 4380); only block when second 16-bit group is 0x0000.
  // Using /32 on the base 2001:0000:: correctly matches only the Teredo range,
  // not e.g. 2001:4860:: (Google's public IPv6 DNS).
  if (inIPv6Range(bytes, "2001:0000::", 32)) return true;

  // 2002::/16 — 6to4 (can reach private IPv4 ranges)
  if (inIPv6Range(bytes, "2002::", 16)) return true;

  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// assertOutboundFetchAllowed
// ──────────────────────────────────────────────────────────────────────────────

export interface OutboundFetchPolicyOptions {
  /** Allow fetching from private/loopback/link-local ranges. Default: false. */
  allowPrivateFetches?: boolean;
  /** Explicit allowlist — hosts or IPs that bypass private-range blocking. */
  allowlist?: string[];
  /**
   * Internal: skip actual DNS resolution (for testing with literal IPs).
   * When true and no _dnsLookupFn is provided, skips the DNS step entirely.
   */
  _skipDns?: boolean;
  /**
   * Internal: injectable DNS lookup function for testing.
   * Receives a hostname and returns a list of resolved IP addresses.
   */
  _dnsLookupFn?: (hostname: string) => Promise<string[]>;
}

/**
 * Merges feed-level policy overrides on top of a global policy baseline.
 *
 * Precedence: feed override > global setting > safe default (false / empty).
 * - If feedConfig explicitly contains `allowPrivateFetches`, that value wins.
 * - The allowlist is the union of the global allowlist and any feed-level allowlist.
 *
 * @param global - The baseline outbound-fetch policy (e.g. from env vars or app config).
 * @param feedConfig - Any object that may carry `allowPrivateFetches` and/or `allowlist`
 *   overrides (raw feed body, stored feed config, etc.).
 */
export function mergeFeedPolicyOptions(
  global: OutboundFetchPolicyOptions,
  feedConfig: Record<string, any> | null | undefined,
): OutboundFetchPolicyOptions {
  const hasFeedOverride = feedConfig != null && "allowPrivateFetches" in feedConfig;
  const feedAllowlist: string[] = parseAllowlist(
    Array.isArray(feedConfig?.allowlist)
      ? feedConfig.allowlist.join(",")
      : feedConfig?.allowlist
  );
  return {
    allowPrivateFetches: hasFeedOverride
      ? (feedConfig!.allowPrivateFetches as boolean)
      : (global.allowPrivateFetches ?? false),
    allowlist: [...new Set([...(global.allowlist ?? []), ...feedAllowlist])],
  };
}

/**
 * Asserts that fetching rawUrl is allowed under the current policy.
 *
 * Throws a descriptive Error if the URL should be blocked.
 *
 * Policy evaluation order:
 * 1. Validate URL is parseable and scheme is http/https
 * 2. Block known metadata hostnames (always — even with allowPrivateFetches)
 * 3. If hostname is a literal IP: block if in blocked range (allowlist can override)
 * 4. If hostname is on allowlist: allow (skips DNS check)
 * 5. Resolve DNS, block if any resolved address is in a blocked range
 *    (unless allowPrivateFetches is true)
 *
 * Caller merge precedence: feed override > global setting/env > safe default
 */
export async function assertOutboundFetchAllowed(
  rawUrl: string,
  options?: OutboundFetchPolicyOptions
): Promise<void> {
  const allowPrivateFetches = options?.allowPrivateFetches ?? false;
  const allowlist = options?.allowlist ?? [];
  const skipDns = options?._skipDns ?? false;
  const dnsLookupFn = options?._dnsLookupFn;

  // ── Step 1: Parse URL and check scheme ────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Outbound fetch blocked: invalid URL "${rawUrl}"`);
  }

  const scheme = parsed.protocol; // includes trailing ':'
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(
      `Outbound fetch blocked: unsupported scheme "${scheme}" in URL "${rawUrl}". ` +
        `Only http: and https: are permitted.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // ── Step 2: Block known metadata hostnames (absolute — no override) ───────
  if (METADATA_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Outbound fetch blocked: hostname "${hostname}" is a known cloud metadata endpoint.`
    );
  }

  // ── Step 3: Check if hostname is a literal IP ─────────────────────────────
  // URL brackets are stripped automatically by the URL parser for IPv6
  const isLiteralIPv4 = net.isIPv4(hostname);
  const isLiteralIPv6 = net.isIPv6(hostname);
  const isLiteralIP = isLiteralIPv4 || isLiteralIPv6;

  if (isLiteralIP) {
    if (isBlockedAddress(hostname)) {
      // Check allowlist before blocking
      if (allowlist.some((entry) => entry === hostname)) {
        return; // explicitly allowed
      }
      if (allowPrivateFetches) {
        return; // admin override — but metadata hosts were already rejected above
      }
      throw new Error(
        `Outbound fetch blocked: IP address "${hostname}" is in a private/reserved range.`
      );
    }
    // Public literal IP — allowed
    return;
  }

  // ── Step 4: Check host allowlist (skip DNS if on list) ────────────────────
  if (allowlist.some((entry) => entry === hostname)) {
    return; // explicitly allowed, skip DNS
  }

  // ── Step 5: DNS resolution ────────────────────────────────────────────────
  if (!skipDns || dnsLookupFn) {
    const resolvedAddresses = dnsLookupFn
      ? await dnsLookupFn(hostname)
      : await resolveHostname(hostname);

    if (resolvedAddresses.length === 0) {
      throw new Error(
        `Outbound fetch blocked: DNS resolution returned no addresses for "${hostname}".`
      );
    }

    for (const addr of resolvedAddresses) {
      if (isBlockedAddress(addr)) {
        if (allowPrivateFetches) {
          continue; // admin override — check remaining addresses
        }
        throw new Error(
          `Outbound fetch blocked: hostname "${hostname}" resolved to "${addr}" ` +
            `which is in a private/reserved range.`
        );
      }
    }
  }
}

/**
 * Resolves a hostname to its IP addresses (both A and AAAA records).
 * Fails closed: if no addresses are resolved at all, throws a policy error.
 */
async function resolveHostname(hostname: string): Promise<string[]> {
  try {
    const [v4, v6] = await Promise.allSettled([
      resolve4(hostname),
      resolve6(hostname),
    ]);
    const addrs: string[] = [];
    if (v4.status === "fulfilled") addrs.push(...v4.value);
    if (v6.status === "fulfilled") addrs.push(...v6.value);
    if (addrs.length === 0) {
      throw new Error(`DNS resolution returned no addresses for "${hostname}".`);
    }
    return addrs;
  } catch {
    // If DNS fails, we can't confirm the address is safe — fail closed.
    throw new Error(
      `Outbound fetch blocked: DNS resolution failed for hostname "${hostname}".`
    );
  }
}

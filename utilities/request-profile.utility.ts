import { randomUUID } from "node:crypto";
import type { EffectiveRequestProfile, ProxyProfile, RequestProfilesState, UserAgentProfile } from "../models/request-profile.model";
import { maskProtectedValues, protectValue, resolveProtectedValues } from "./protected-values.utility";

const profiles: RequestProfilesState = {
  proxyProfiles: [],
  userAgentProfiles: [],
};

function now() {
  return new Date().toISOString();
}

function assertValidProxy(input: Partial<ProxyProfile>) {
  if (!input.name?.trim()) throw new Error("name is required");
  if (!["http", "https", "socks5"].includes(String(input.protocol))) throw new Error("protocol must be http, https, or socks5");
  if (!input.host || !/^[A-Za-z0-9.-]+$/.test(input.host)) throw new Error("host is invalid");
  if (!Number.isInteger(input.port) || input.port! < 1 || input.port! > 65535) throw new Error("port is invalid");
}

function assertValidUserAgent(input: Partial<UserAgentProfile>) {
  if (!input.name?.trim()) throw new Error("name is required");
  if (!input.userAgent?.trim() || input.userAgent.length < 8) throw new Error("userAgent is invalid");
}

export function clearRequestProfiles() {
  profiles.proxyProfiles = [];
  profiles.userAgentProfiles = [];
}

export function listRequestProfiles(): RequestProfilesState {
  return {
    proxyProfiles: maskProtectedValues(profiles.proxyProfiles) as ProxyProfile[],
    userAgentProfiles: [...profiles.userAgentProfiles],
  };
}

export function upsertProxyProfile(input: Partial<ProxyProfile>, encryptionKey = ""): ProxyProfile {
  assertValidProxy(input);
  const existing = input.id ? profiles.proxyProfiles.find((profile) => profile.id === input.id) : undefined;
  const timestamp = now();
  const profile: ProxyProfile = {
    ...(existing ?? { id: input.id ?? randomUUID(), createdAt: timestamp }),
    name: input.name!.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    protocol: input.protocol!,
    host: input.host!,
    port: Number(input.port),
    username: input.username,
    password: typeof input.password === "string" && input.password && input.password !== "********"
      ? protectValue(input.password, encryptionKey)
      : existing?.password,
    headers: input.headers ?? existing?.headers,
    updatedAt: timestamp,
  };
  profiles.proxyProfiles = profiles.proxyProfiles.filter((item) => item.id !== profile.id).concat(profile);
  return maskProtectedValues(profile) as ProxyProfile;
}

export function upsertUserAgentProfile(input: Partial<UserAgentProfile>): UserAgentProfile {
  assertValidUserAgent(input);
  const existing = input.id ? profiles.userAgentProfiles.find((profile) => profile.id === input.id) : undefined;
  const timestamp = now();
  const profile: UserAgentProfile = {
    ...(existing ?? { id: input.id ?? randomUUID(), createdAt: timestamp }),
    name: input.name!.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    userAgent: input.userAgent!.trim(),
    updatedAt: timestamp,
  };
  profiles.userAgentProfiles = profiles.userAgentProfiles.filter((item) => item.id !== profile.id).concat(profile);
  return profile;
}

export function deleteRequestProfile(kind: "proxy" | "userAgent", id: string): boolean {
  const list = kind === "proxy" ? profiles.proxyProfiles : profiles.userAgentProfiles;
  const before = list.length;
  const next = list.filter((profile) => profile.id !== id);
  if (kind === "proxy") profiles.proxyProfiles = next as ProxyProfile[];
  else profiles.userAgentProfiles = next as UserAgentProfile[];
  return next.length !== before;
}

export function resolveEffectiveRequestProfile(feedConfig: Record<string, any> = {}, encryptionKey = ""): EffectiveRequestProfile {
  const request = feedConfig.config?.request ?? feedConfig.request ?? {};
  const proxyProfile = profiles.proxyProfiles.find((profile) => profile.enabled && profile.id === (request.proxyProfileId ?? feedConfig.config?.proxyId ?? feedConfig.config?.proxyProfileId));
  const userAgentProfile = profiles.userAgentProfiles.find((profile) => profile.enabled && profile.id === (request.userAgentProfileId ?? feedConfig.config?.userAgentProfileId));
  const proxyOverride = request.proxyOverride;
  const userAgent = request.userAgentOverride ?? userAgentProfile?.userAgent ?? feedConfig.config?.userAgent;
  const proxySource = proxyOverride ?? proxyProfile;
  return {
    userAgent,
    proxy: proxySource ? {
      protocol: proxySource.protocol,
      host: proxySource.host,
      port: Number(proxySource.port),
      auth: proxySource.username ? {
        username: proxySource.username,
        password: proxySource.password ? resolveProtectedValues(proxySource.password, { encryptionKey }) : undefined,
      } : undefined,
    } : undefined,
    headers: proxySource?.headers ? resolveProtectedValues(proxySource.headers, { encryptionKey }) : undefined,
  };
}

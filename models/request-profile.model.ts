import type { ProtectedRecord, ProtectedValue } from "./protected-value.model";

export type ProxyProfile = {
  id: string;
  name: string;
  enabled: boolean;
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: ProtectedValue | string;
  headers?: ProtectedRecord;
  createdAt: string;
  updatedAt: string;
};

export type UserAgentProfile = {
  id: string;
  name: string;
  enabled: boolean;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
};

export type RequestProfilesState = {
  proxyProfiles: ProxyProfile[];
  userAgentProfiles: UserAgentProfile[];
};

export type EffectiveRequestProfile = {
  userAgent?: string;
  proxy?: {
    protocol: "http" | "https" | "socks5";
    host: string;
    port: number;
    auth?: { username: string; password?: string };
  };
  headers?: Record<string, unknown>;
};

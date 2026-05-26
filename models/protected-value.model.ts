export type ProtectedValue =
  | { type: "protected"; value: string }
  | { type: "env"; value: string; prefix?: string; suffix?: string };

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ProtectedValue
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export type ProtectedRecord = Record<string, string | ProtectedValue>;

export type HeaderValue = string | ProtectedValue;

export type WebScrapingFormFieldValue =
  | string
  | number
  | boolean
  | ProtectedValue
  | Array<string | number | boolean | ProtectedValue>;

export type FeedCookie = {
  name: string;
  value: string | ProtectedValue;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
};

import type { ProtectedValue } from "./protected-value.model";

export type WebScrapingRequestConfig =
  | WebScrapingSimpleRequestConfig
  | WebScrapingFormRequestConfig;

export type WebScrapingSimpleRequestConfig = {
  mode: "simple";
};

export type WebScrapingFormRequestConfig = {
  mode: "form";
  method: "GET" | "POST";
  actionUrl?: string;
  encoding:
    | "application/x-www-form-urlencoded"
    | "multipart/form-data"
    | "application/json";
  fields: Record<string, WebScrapingFormFieldValue>;
  submit?: WebScrapingFormSubmitOptions;
};

export type WebScrapingFormFieldValue =
  | string
  | number
  | boolean
  | ProtectedValue
  | Array<string | number | boolean | ProtectedValue>;

export type WebScrapingFormSubmitOptions = {
  followRedirects?: boolean;
  scrape?: "responseBody" | "finalResponse";
};

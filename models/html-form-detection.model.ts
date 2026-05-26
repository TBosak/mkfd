import type { FeedCookie, ProtectedRecord } from "./protected-value.model";

export type DetectFormsRequest = {
  url: string;
  headers?: ProtectedRecord;
  cookies?: FeedCookie[];
  advanced?: boolean;
  userAgent?: string;
  timeoutMs?: number;
};

export type DetectFormsResponse = {
  url: string;
  finalUrl: string;
  forms: DetectedHtmlForm[];
  warnings: string[];
};

export type DetectedHtmlForm = {
  id: string;
  index: number;
  label: string;
  method: "GET" | "POST";
  actionUrl: string;
  encoding: "application/x-www-form-urlencoded" | "multipart/form-data";
  selector: string;
  fields: DetectedHtmlFormField[];
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  warnings: string[];
};

export type DetectedHtmlFormField = {
  name: string;
  type:
    | "text" | "search" | "hidden" | "password" | "email" | "number"
    | "checkbox" | "radio" | "select" | "textarea"
    | "submit" | "button" | "unknown";
  label?: string;
  value?: string;
  required?: boolean;
  placeholder?: string;
  options?: DetectedHtmlFormFieldOption[];
  checked?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  sensitive?: boolean;
  dynamic?: boolean;
};

export type DetectedHtmlFormFieldOption = {
  label: string;
  value: string;
  selected?: boolean;
};

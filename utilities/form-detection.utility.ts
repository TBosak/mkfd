import * as cheerio from "cheerio";
import type { DetectFormsRequest, DetectFormsResponse, DetectedHtmlForm, DetectedHtmlFormField } from "../models/html-form-detection.model";
import type { WebScrapingFormRequestConfig } from "../models/web-scraping-request.model";
import { getGlobalFetchPolicyOptions } from "./outbound-fetch-policy.utility";
import { axiosGetWithPolicyRedirects } from "./feed-config-route-adapter.utility";

const SENSITIVE_RE = /password|pass|token|secret|apikey|auth|authorization|session|cookie|csrf|nonce/i;

function confidenceBand(score: number): "high" | "medium" | "low" {
  if (score >= 30) return "high";
  if (score >= 10) return "medium";
  return "low";
}

function fieldType(el: cheerio.Element, $el: cheerio.Cheerio): DetectedHtmlFormField["type"] {
  const tag = el.tagName.toLowerCase();
  if (tag === "select" || tag === "textarea") return tag;
  const type = ($el.attr("type") || "text").toLowerCase();
  if (["text", "search", "hidden", "password", "email", "number", "checkbox", "radio", "submit", "button"].includes(type)) {
    return type as DetectedHtmlFormField["type"];
  }
  return "unknown";
}

export function scoreDetectedForm(form: DetectedHtmlForm): number {
  let score = 0;
  const fieldNames = form.fields.map((field) => field.name).join(" ");
  if (form.fields.some((field) => field.type === "search")) score += 30;
  if (/\b(q|query|search|keyword|term|s)\b/i.test(fieldNames)) score += 25;
  if (/search/i.test(form.actionUrl)) score += 20;
  if (form.fields.some((field) => field.type === "select")) score += 10;
  if (form.method === "GET") score += 5;
  if (form.fields.some((field) => field.type === "password")) score -= 40;
  if (/login|signin|subscribe|newsletter/i.test(form.actionUrl)) score -= 25;
  if (/comment/i.test(form.actionUrl)) score -= 15;
  if (!form.fields.some((field) => ["text", "search", "select"].includes(field.type))) score -= 10;
  return score;
}

export function detectForms(html: string, pageUrl: string): DetectedHtmlForm[] {
  const $ = cheerio.load(html);
  return $("form").toArray().map((el, index) => {
    const $form = $(el);
    const actionUrl = new URL($form.attr("action") || pageUrl, pageUrl).toString();
    const method = (($form.attr("method") || "GET").toUpperCase() === "POST" ? "POST" : "GET") as "GET" | "POST";
    const encoding = (($form.attr("enctype") || "application/x-www-form-urlencoded").toLowerCase() === "multipart/form-data"
      ? "multipart/form-data"
      : "application/x-www-form-urlencoded") as DetectedHtmlForm["encoding"];
    const fields = $form.find("input, select, textarea").toArray().map((input): DetectedHtmlFormField | null => {
      const $input = $(input);
      const name = $input.attr("name") || "";
      if (!name) return null;
      const type = fieldType(input, $input);
      const label = $input.attr("aria-label") || $(`label[for='${$input.attr("id") || ""}']`).text().trim() || undefined;
      return {
        name,
        type,
        label,
        value: $input.attr("value"),
        required: $input.attr("required") !== undefined,
        placeholder: $input.attr("placeholder"),
        checked: $input.attr("checked") !== undefined,
        disabled: $input.attr("disabled") !== undefined,
        readonly: $input.attr("readonly") !== undefined,
        sensitive: SENSITIVE_RE.test(`${name} ${type} ${label ?? ""}`),
        options: type === "select"
          ? $input.find("option").toArray().map((option) => ({
              label: $(option).text().trim(),
              value: $(option).attr("value") ?? $(option).text().trim(),
              selected: $(option).attr("selected") !== undefined,
            }))
          : undefined,
      };
    }).filter(Boolean) as DetectedHtmlFormField[];
    const initial: DetectedHtmlForm = {
      id: `form-${index + 1}`,
      index,
      label: $form.attr("aria-label") || $form.attr("name") || `Form ${index + 1}`,
      method,
      actionUrl,
      encoding,
      selector: `form:nth-of-type(${index + 1})`,
      fields,
      confidence: 0,
      confidenceBand: "low",
      warnings: fields.some((field) => field.type === "password") ? ["Password fields are not recommended for automated scraping."] : [],
    };
    const score = scoreDetectedForm(initial);
    return { ...initial, confidence: score, confidenceBand: confidenceBand(score) };
  }).sort((a, b) => b.confidence - a.confidence);
}

export function detectedFormToRequestConfig(form: DetectedHtmlForm): WebScrapingFormRequestConfig {
  const fields = Object.fromEntries(
    form.fields
      .filter((field) => !field.disabled && !["submit", "button"].includes(field.type))
      .map((field) => [field.name, field.value ?? field.options?.find((option) => option.selected)?.value ?? ""]),
  );
  return {
    mode: "form",
    method: form.method,
    actionUrl: form.actionUrl,
    encoding: form.encoding,
    fields,
    submit: { followRedirects: true, scrape: "finalResponse" },
  };
}

export async function detectFormsFromUrl(request: DetectFormsRequest): Promise<DetectFormsResponse> {
  const policyOptions = getGlobalFetchPolicyOptions();
  const response = await axiosGetWithPolicyRedirects(request.url, {
    timeout: request.timeoutMs ?? 10000,
    responseType: "text",
    headers: request.headers as Record<string, string> | undefined,
  }, policyOptions);
  const finalUrl = response.request?.res?.responseUrl ?? request.url;
  return {
    url: request.url,
    finalUrl,
    forms: detectForms(String(response.data ?? ""), finalUrl),
    warnings: [],
  };
}

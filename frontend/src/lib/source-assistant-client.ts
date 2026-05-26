import type {
  SourceAssistantAnalyzeResponse,
  SourceAssistantApplyResponse,
  WebPageAnalysisResponse,
} from "@/types/source-assistant";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? "Source Assistant request failed");
  }
  return body as T;
}

export async function analyzeSource(url: string, options?: Record<string, unknown>) {
  const response = await fetch("/source-assistant/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, options }),
  });
  return readJson<SourceAssistantAnalyzeResponse>(response);
}

export async function applySourceAssistantRecommendation(
  analysisId: string,
  recommendationId: string,
  options?: Record<string, unknown>,
) {
  const response = await fetch("/source-assistant/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysisId, recommendationId, options }),
  });
  return readJson<SourceAssistantApplyResponse>(response);
}

export async function analyzeWebPage(url: string, options?: Record<string, unknown>) {
  const response = await fetch("/utils/analyze-web-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, options }),
  });
  return readJson<WebPageAnalysisResponse>(response);
}

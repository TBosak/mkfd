import { useMemo, useState } from "react";
import { analyzeSource, applySourceAssistantRecommendation } from "@/lib/source-assistant-client";
import type { SourceAssistantAnalyzeResponse, SourceAssistantApplyResponse } from "@/types/source-assistant";

export type SourceAssistantStatus = "idle" | "analyzing" | "ready" | "error";

export function useSourceAssistant() {
  const [status, setStatus] = useState<SourceAssistantStatus>("idle");
  const [analysis, setAnalysis] = useState<SourceAssistantAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState("");

  const isStale = useMemo(() => Boolean(analysis && lastUrl && analysis.observation?.url !== lastUrl), [analysis, lastUrl]);

  async function analyze(url: string, options?: Record<string, unknown>) {
    setStatus("analyzing");
    setError(null);
    setLastUrl(url);
    try {
      const result = await analyzeSource(url, options);
      setAnalysis(result);
      setStatus("ready");
      return result;
    } catch (err: any) {
      setError(err?.message ?? "Analysis failed");
      setStatus("error");
      throw err;
    }
  }

  async function apply(recommendationId: string): Promise<SourceAssistantApplyResponse> {
    if (!analysis) throw new Error("Analyze a source before applying a recommendation.");
    return applySourceAssistantRecommendation(analysis.analysisId, recommendationId);
  }

  function reset() {
    setStatus("idle");
    setAnalysis(null);
    setError(null);
  }

  return { status, analysis, error, isStale, setLastUrl, analyze, apply, reset };
}

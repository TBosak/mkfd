import { Hono } from "hono";
import { getGlobalFetchPolicyOptions } from "../utilities/outbound-fetch-policy.utility";
import { makeSourceAnalysisCacheKey, getCachedAnalysis, getCachedAnalysisById, setCachedAnalysis } from "../utilities/source-assistant/analysis-cache.utility";
import { observeSource } from "../utilities/source-assistant/observer.utility";
import { buildRecommendations } from "../utilities/source-assistant/recommender.utility";
import { buildStarterConfig } from "../utilities/source-assistant/starter-configs";
import type { SourceAssistantAnalyzeRequest, SourceAssistantApplyRequest } from "../models/source-assistant.model";

export const sourceAssistantRouter = new Hono();

sourceAssistantRouter.post("/source-assistant/analyze", async (c) => {
  const body = await c.req.json<SourceAssistantAnalyzeRequest>().catch(() => null);
  if (!body?.url) return c.json({ error: "url is required" }, 400);

  const key = makeSourceAnalysisCacheKey(body.url, body.options ?? {});
  const cached = getCachedAnalysis(key);
  if (cached) {
    return c.json({
      analysisId: cached.analysisId,
      analyzedAt: cached.observation.analyzedAt,
      observation: cached.observation,
      recommendations: cached.recommendations,
      warnings: cached.observation.warnings,
    });
  }

  const observation = await observeSource(body, { policyOptions: getGlobalFetchPolicyOptions() });
  const recommendations = buildRecommendations(observation);
  const entry = setCachedAnalysis({ key, observation, recommendations });
  return c.json({
    analysisId: entry.analysisId,
    analyzedAt: observation.analyzedAt,
    observation,
    recommendations,
    warnings: observation.warnings,
  });
});

sourceAssistantRouter.post("/source-assistant/apply", async (c) => {
  const body = await c.req.json<SourceAssistantApplyRequest>().catch(() => null);
  if (!body?.analysisId || !body?.recommendationId) {
    return c.json({ error: "analysisId and recommendationId are required" }, 400);
  }
  const entry = getCachedAnalysisById(body.analysisId);
  if (!entry) return c.json({ error: "analysis not found" }, 404);
  const recommendation = entry.recommendations.find((rec) => rec.id === body.recommendationId);
  if (!recommendation) return c.json({ error: "recommendation not found" }, 404);
  return c.json({
    routeType: recommendation.routeType,
    starterConfig: buildStarterConfig(recommendation, entry.observation, body.options ?? {}),
    recommendation,
    warnings: [...entry.observation.warnings, ...recommendation.warnings],
  });
});

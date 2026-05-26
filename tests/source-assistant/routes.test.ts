import { describe, expect, test } from "bun:test";
import { sourceAssistantRouter } from "../../routes/source-assistant";

describe("source assistant routes", () => {
  test("analyze validates url", async () => {
    const res = await sourceAssistantRouter.request("/source-assistant/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("apply returns 404 for unknown analysis", async () => {
    const res = await sourceAssistantRouter.request("/source-assistant/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId: "missing", recommendationId: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});

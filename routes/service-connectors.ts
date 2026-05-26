import { Hono } from "hono";
import { listServiceConnectors } from "../utilities/service-connector-registry.utility";
import { listServiceConnectorResources, testServiceConnector, runServiceConnector } from "../utilities/service-connector-runner.utility";
import { maskProtectedValues } from "../utilities/protected-values.utility";

export function serviceConnectorsRouter(deps: { encryptionKey: string }): Hono {
  const app = new Hono();

  app.get("/service-connectors", (ctx) => ctx.json({ connectors: listServiceConnectors() }));

  app.post("/service-connectors/:service/test", async (ctx) => {
    try {
      const config = await ctx.req.json();
      return ctx.json({ result: await testServiceConnector(config, deps.encryptionKey), config: maskProtectedValues(config) });
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Connection test failed" }, 400);
    }
  });

  app.post("/service-connectors/:service/resources", async (ctx) => {
    try {
      const config = await ctx.req.json();
      return ctx.json({ resources: await listServiceConnectorResources(config, deps.encryptionKey) });
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Resource discovery failed" }, 400);
    }
  });

  app.post("/service-connectors/:service/preview", async (ctx) => {
    try {
      const config = await ctx.req.json();
      const result = await runServiceConnector(config, deps.encryptionKey, null);
      return ctx.json({ items: result.items, warnings: result.warnings ?? [] });
    } catch (err: any) {
      return ctx.json({ error: err?.message ?? "Preview failed" }, 400);
    }
  });

  return app;
}

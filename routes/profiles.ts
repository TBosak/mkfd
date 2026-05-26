import { Hono } from "hono";
import { deleteRequestProfile, listRequestProfiles, upsertProxyProfile, upsertUserAgentProfile } from "../utilities/request-profile.utility";

export const profilesRouter = new Hono();

profilesRouter.get("/api/settings/request-profiles", (c) => c.json(listRequestProfiles()));

profilesRouter.post("/api/settings/request-profiles/proxy", async (c) => {
  try {
    return c.json(upsertProxyProfile(await c.req.json(), process.env.ENCRYPTION_KEY ?? ""), 201);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Invalid proxy profile" }, 400);
  }
});

profilesRouter.put("/api/settings/request-profiles/proxy/:id", async (c) => {
  try {
    return c.json(upsertProxyProfile({ ...(await c.req.json()), id: c.req.param("id") }, process.env.ENCRYPTION_KEY ?? ""));
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Invalid proxy profile" }, 400);
  }
});

profilesRouter.post("/api/settings/request-profiles/user-agent", async (c) => {
  try {
    return c.json(upsertUserAgentProfile(await c.req.json()), 201);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Invalid user-agent profile" }, 400);
  }
});

profilesRouter.put("/api/settings/request-profiles/user-agent/:id", async (c) => {
  try {
    return c.json(upsertUserAgentProfile({ ...(await c.req.json()), id: c.req.param("id") }));
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Invalid user-agent profile" }, 400);
  }
});

profilesRouter.delete("/api/settings/request-profiles/:kind/:id", (c) => {
  const kind = c.req.param("kind");
  if (kind !== "proxy" && kind !== "userAgent") return c.json({ error: "invalid profile kind" }, 400);
  return c.json({ deleted: deleteRequestProfile(kind, c.req.param("id")) });
});

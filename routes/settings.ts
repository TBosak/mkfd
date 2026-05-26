/**
 * Settings API Routes
 *
 * GET  /api/settings  — returns effective settings (all keys) with source,
 *                       restart metadata, and class. Masked values for class C.
 * PUT  /api/settings  — partial update for class A/B keys. Rejects class C
 *                       and unknown keys. Returns updated effective settings.
 */

import { Hono } from "hono";
import { getDb } from "../lib/analytics/db";
import {
  getEffectiveSettings,
  applySettingsUpdate,
  validateSettingsUpdate,
  SETTING_REGISTRY,
} from "../utilities/app-settings.utility";
import type { SettingValue } from "../utilities/app-settings.utility";

const settingsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

settingsRouter.get("/", async (c) => {
  try {
    const settings = await getEffectiveSettings(getDb());
    return c.json({
      settings,
      meta: {
        dbPath: process.env.RUNTIME_DB_PATH ?? "./data/runtime.db",
      },
    });
  } catch (err) {
    console.error("[settings] GET /api/settings error:", err);
    return c.json({ error: "Failed to retrieve settings" }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------

settingsRouter.put("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  // Cast incoming values to the correct types according to the registry.
  // Unknown keys are preserved as-is and will fail the schema check below.
  const castInput: Record<string, SettingValue> = {};
  for (const [key, rawValue] of Object.entries(body)) {
    const meta = SETTING_REGISTRY[key];
    if (!meta) {
      // Unknown key — pass it through; validation will reject it
      castInput[key] = rawValue as SettingValue;
      continue;
    }
    switch (meta.type) {
      case "number":
        castInput[key] = Number(rawValue);
        break;
      case "boolean":
        if (typeof rawValue === "boolean") {
          castInput[key] = rawValue;
        } else {
          castInput[key] = rawValue === "true" || rawValue === "1" || rawValue === 1;
        }
        break;
      case "string[]":
        castInput[key] = Array.isArray(rawValue)
          ? (rawValue as string[])
          : String(rawValue)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        break;
      default:
        castInput[key] = String(rawValue);
    }
  }

  const errors = validateSettingsUpdate(castInput);
  if (errors.length > 0) {
    return c.json(
      {
        error: "Validation failed",
        details: errors,
      },
      400,
    );
  }

  try {
    const updated = await applySettingsUpdate(getDb(), castInput);
    return c.json({ settings: updated });
  } catch (err) {
    console.error("[settings] PUT /api/settings error:", err);
    return c.json({ error: "Failed to save settings" }, 500);
  }
});

export { settingsRouter };

/**
 * Preview Route
 *
 * POST /preview — generate a preview of a feed config
 */

import { Hono } from "hono";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { generatePreview } from "../utilities/preview-generator.utility";
import { serializeAllFeedFormats } from "../utilities/feed-output.utility";

export function previewRouter(deps: { encryptionKey: string }): Hono {
  const { encryptionKey } = deps;
  const app = new Hono();

  type PreviewFormat = "rss2" | "atom" | "json";

  app.post("/preview", async (ctx) => {
    try {
      const jsonData = await ctx.req.json();

      let previewConfig: any;
      try {
        previewConfig = castFeedFormDataToFeedConfig(
          jsonData as Record<string, unknown>,
          { feedId: "preview", encryptionKey },
        );
      } catch (castErr: any) {
        return ctx.json(
          { errors: [{ path: "feedType", message: castErr.message }] },
          400,
        );
      }

      const previewValidation = validateFeedConfig(previewConfig);
      if (!previewValidation.valid) {
        return ctx.json(
          {
            errors: previewValidation.errors,
            warnings: previewValidation.warnings,
          },
          400,
        );
      }

      // Carry _debug_advanced_raw for logging in generatePreview
      previewConfig._debug_advanced_raw = jsonData.advanced;

      const format = (ctx.req.query("format") ?? "rss2") as PreviewFormat;

      const feed = await generatePreview(previewConfig);
      const outputs = serializeAllFeedFormats(feed);
      const body = outputs[format] ?? outputs.rss2;
      const contentTypeMap: Record<PreviewFormat, string> = {
        rss2: "application/rss+xml; charset=utf-8",
        atom: "application/atom+xml; charset=utf-8",
        json: "application/feed+json; charset=utf-8",
      };

      return ctx.text(body, 200, {
        "Content-Type": contentTypeMap[format] ?? contentTypeMap.rss2,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
    } catch (error: any) {
      console.error("Error generating preview:", error);
      if (error?.message?.startsWith("Outbound fetch blocked")) {
        return ctx.text(error.message, 403);
      }
      if (error.response?.data) {
        console.error("Error response data:", error.response.data);
        return ctx.text(
          `Error generating preview: ${error.message}. Server responded with: ${JSON.stringify(error.response.data)}`,
          400,
        );
      } else if (error.request) {
        console.error("Error request data:", error.request);
        return ctx.text(
          `Error generating preview: ${error.message}. No response received from server.`,
          400,
        );
      }
      return ctx.text(`Error generating preview: ${error.message}`, 400);
    }
  });

  return app;
}

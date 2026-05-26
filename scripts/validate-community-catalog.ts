import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { getCatalogManifest } from "../utilities/community-catalog/catalog-client.utility";
import { hasFeedTemplate, renderFeedConfigTemplate } from "../utilities/feed-template.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";

const catalogDir = join(__dirname, "../community-catalog");
const manifest = await getCatalogManifest({ catalogDir, cacheMs: 0 });
const ids = new Set<string>();
const errors: string[] = [];

for (const entry of manifest.feeds) {
  if (ids.has(entry.id)) errors.push(`Duplicate catalog id: ${entry.id}`);
  ids.add(entry.id);

  const raw = await readFile(join(catalogDir, entry.path), "utf8");
  const config = yaml.load(raw) as Record<string, unknown>;
  const validationTarget = hasFeedTemplate(config)
    ? renderFeedConfigTemplate(config, {
        feedId: "catalog-validation",
        encryptionKey: "1234567890123456",
        values: Object.fromEntries(
          Object.entries(config.template.variables).map(([name, variable]) => [name, variable.defaultValue ?? sampleValue(variable.type)]),
        ),
        secretStorage: Object.fromEntries(
          Object.entries(config.template.variables)
            .filter(([, variable]) => variable.type === "secret")
            .map(([name]) => [name, "plain"]),
        ),
      })
    : { ...config, feedId: "catalog-validation" };

  const validation = validateFeedConfig(validationTarget as any);
  errors.push(...validation.errors.map((issue) => `${entry.id}: ${issue.path}: ${issue.message}`));
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${manifest.feeds.length} catalog feed(s).`);

function sampleValue(type: string): unknown {
  if (type === "number") return 1;
  if (type === "boolean") return true;
  if (type === "url") return "https://example.com";
  if (type === "secret") return "secret";
  return "sample";
}

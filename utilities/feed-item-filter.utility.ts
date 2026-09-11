import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type { BasicFilterRule, BasicItemTransformConfig } from "../models/feed-transformer.model";
import {
  prepareSafePatternFilters,
  type PreparedSafePatternRule,
  type SafePatternRuntimeOptions,
  testPreparedSafePattern,
} from "./safe-user-pattern.utility";

export type FilterFeedItemsInput = {
  items: NormalizedFeedItem[];
  filters?: BasicItemTransformConfig["filters"];
};

export type FilterFeedItemsResult = {
  items: NormalizedFeedItem[];
  filteredItemCount: number;
};

export function filterFeedItems(
  input: FilterFeedItemsInput,
  options: SafePatternRuntimeOptions = {},
): FilterFeedItemsResult {
  const { items, filters } = input;
  if (!filters || (!filters.include?.length && !filters.exclude?.length)) {
    return { items, filteredItemCount: 0 };
  }

  const preparedFilters = prepareSafePatternFilters(filters, (rule) => rule.type === "regex", options);
  const kept = items.filter((item) => {
    if (preparedFilters.exclude.some((rule) => matchesRule(item, rule))) return false;
    if (preparedFilters.include.length) {
      return preparedFilters.include.some((rule) => matchesRule(item, rule));
    }
    return true;
  });

  return { items: kept, filteredItemCount: items.length - kept.length };
}

function matchesRule(item: NormalizedFeedItem, prepared: PreparedSafePatternRule<BasicFilterRule>): boolean {
  const { rule } = prepared;
  if (rule.field === "categories") {
    return (item.categories ?? []).some((category) => matchValue(category, prepared));
  }

  const raw = (item as Record<string, unknown>)[rule.field];
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((value) => matchValue(String(value), prepared));
  return matchValue(String(raw), prepared);
}

function matchValue(value: string, prepared: PreparedSafePatternRule<BasicFilterRule>): boolean {
  const { rule } = prepared;
  const haystack = rule.caseSensitive ? value : value.toLowerCase();
  const needle = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

  switch (rule.type) {
    case "contains": return haystack.includes(needle);
    case "notContains": return !haystack.includes(needle);
    case "equals": return haystack === needle;
    case "startsWith": return haystack.startsWith(needle);
    case "endsWith": return haystack.endsWith(needle);
    case "regex": return testPreparedSafePattern(prepared, value);
    default: return false;
  }
}

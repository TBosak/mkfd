import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type { BasicFilterRule, BasicItemTransformConfig } from "../models/feed-transformer.model";

export type FilterFeedItemsInput = {
  items: NormalizedFeedItem[];
  filters?: BasicItemTransformConfig["filters"];
};

export type FilterFeedItemsResult = {
  items: NormalizedFeedItem[];
  filteredItemCount: number;
};

export function filterFeedItems(input: FilterFeedItemsInput): FilterFeedItemsResult {
  const { items, filters } = input;
  if (!filters || (!filters.include?.length && !filters.exclude?.length)) {
    return { items, filteredItemCount: 0 };
  }

  const kept = items.filter((item) => {
    if (filters.exclude?.some((rule) => matchesRule(item, rule))) return false;
    if (filters.include?.length) {
      return filters.include.some((rule) => matchesRule(item, rule));
    }
    return true;
  });

  return { items: kept, filteredItemCount: items.length - kept.length };
}

function matchesRule(item: NormalizedFeedItem, rule: BasicFilterRule): boolean {
  if (rule.field === "categories") {
    return (item.categories ?? []).some((category) => matchValue(category, rule));
  }

  const raw = (item as Record<string, unknown>)[rule.field];
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((value) => matchValue(String(value), rule));
  return matchValue(String(raw), rule);
}

function matchValue(value: string, rule: BasicFilterRule): boolean {
  const haystack = rule.caseSensitive ? value : value.toLowerCase();
  const needle = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

  switch (rule.type) {
    case "contains": return haystack.includes(needle);
    case "notContains": return !haystack.includes(needle);
    case "equals": return haystack === needle;
    case "startsWith": return haystack.startsWith(needle);
    case "endsWith": return haystack.endsWith(needle);
    case "regex":
      try {
        return new RegExp(rule.value, rule.caseSensitive ? "" : "i").test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

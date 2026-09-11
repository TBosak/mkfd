import { describe, expect, test } from "bun:test";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import { filterFeedItems } from "../utilities/feed-item-filter.utility";

const item = (
	overrides: Partial<NormalizedFeedItem> = {},
): NormalizedFeedItem => ({
	title: "Test Title",
	...overrides,
});

describe("filterFeedItems", () => {
	test("returns all items when no filters provided", () => {
		const result = filterFeedItems({
			items: [item(), item({ title: "Other" })],
		});
		expect(result.items).toHaveLength(2);
		expect(result.filteredItemCount).toBe(0);
	});

	test("exclude contains removes matching item", () => {
		const result = filterFeedItems({
			items: [
				item({ title: "Sponsored Post" }),
				item({ title: "Regular Post" }),
			],
			filters: {
				exclude: [
					{
						field: "title",
						type: "contains",
						value: "sponsored",
						caseSensitive: false,
					},
				],
			},
		});
		expect(result.items.map((i) => i.title)).toEqual(["Regular Post"]);
		expect(result.filteredItemCount).toBe(1);
	});

	test("include keeps matching items and exclude wins", () => {
		const result = filterFeedItems({
			items: [
				item({ title: "Tech Sponsored" }),
				item({ title: "Tech News" }),
				item({ title: "Sports" }),
			],
			filters: {
				include: [
					{
						field: "title",
						type: "contains",
						value: "tech",
						caseSensitive: false,
					},
				],
				exclude: [
					{
						field: "title",
						type: "contains",
						value: "sponsored",
						caseSensitive: false,
					},
				],
			},
		});
		expect(result.items.map((i) => i.title)).toEqual(["Tech News"]);
		expect(result.filteredItemCount).toBe(2);
	});

	test("categories match any category and invalid regex throws a sanitized error", () => {
		const cats = filterFeedItems({
			items: [
				item({ categories: ["tech", "gadgets"] }),
				item({ categories: ["sports"] }),
			],
			filters: {
				exclude: [{ field: "categories", type: "contains", value: "tech" }],
			},
		});
		expect(cats.items).toHaveLength(1);
		const invalidPattern = "[invalid";
		let thrown: unknown;
		try {
			filterFeedItems({
				items: [item()],
				filters: {
					exclude: [{ field: "title", type: "regex", value: invalidPattern }],
				},
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		const message = thrown instanceof Error ? thrown.message : String(thrown);
		expect(message).toMatch(/pattern|regex|regular expression/i);
		expect(message).not.toContain(invalidPattern);
	});
});

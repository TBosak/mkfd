import { Buffer } from "node:buffer";

export const PARSER_INPUT_LIMITS = {
	existingFeedBytes: 4 * 1024 * 1024,
	documentBytes: 2 * 1024 * 1024,
	jsonLdBlockBytes: 500_000,
	jsonLdBlocks: 20,
} as const;

type ParserInputClass = "existing-feed" | "sitemap" | "calendar" | "json-ld-html";

const INPUT_CLASS_POLICY: Record<ParserInputClass, { label: string; maxBytes: number }> = {
	"existing-feed": {
		label: "Existing feed",
		maxBytes: PARSER_INPUT_LIMITS.existingFeedBytes,
	},
	sitemap: {
		label: "Sitemap",
		maxBytes: PARSER_INPUT_LIMITS.documentBytes,
	},
	calendar: {
		label: "Calendar",
		maxBytes: PARSER_INPUT_LIMITS.documentBytes,
	},
	"json-ld-html": {
		label: "JSON-LD HTML",
		maxBytes: PARSER_INPUT_LIMITS.documentBytes,
	},
};

function encodedInputBytes(input: string): number {
	return Buffer.byteLength(input, "utf8");
}

export function inputFitsByteLimit(input: string, maxBytes: number): boolean {
	return encodedInputBytes(input) <= maxBytes;
}

export function assertParserInputWithinLimit(input: string, inputClass: ParserInputClass): void {
	const policy = INPUT_CLASS_POLICY[inputClass];
	if (inputFitsByteLimit(input, policy.maxBytes)) return;
	throw new Error(`${policy.label} input exceeds the ${policy.maxBytes}-byte size limit.`);
}

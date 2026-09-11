import { RE2JS } from "re2js";

const SAFE_PATTERN_LIMITS = {
	patternBytes: 512,
	candidateBytes: 64 * 1024,
	regexRules: 64,
} as const;

export type SafePatternRule = {
	type: string;
	value: string;
	caseSensitive?: boolean;
};

export type SafePatternFilters<Rule extends SafePatternRule> = {
	include?: Rule[];
	exclude?: Rule[];
};

export type SafePatternRuntimeOptions = {
	onPatternCompiled?: () => void;
};

export type SafePatternValidationIssue = {
	list: "include" | "exclude";
	index: number;
	message: string;
};

export type PreparedSafePatternRule<Rule extends SafePatternRule> = {
	rule: Rule;
	matcher?: Pick<RE2JS, "test">;
};

export type PreparedSafePatternFilters<Rule extends SafePatternRule> = {
	include: PreparedSafePatternRule<Rule>[];
	exclude: PreparedSafePatternRule<Rule>[];
};

class SafeUserPatternError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SafeUserPatternError";
	}
}

const encoder = new TextEncoder();

export function validateSafePatternFilters<Rule extends SafePatternRule>(
	filters: SafePatternFilters<Rule> | undefined,
	isRegexRule: (rule: Rule) => boolean,
): SafePatternValidationIssue[] {
	const issues: SafePatternValidationIssue[] = [];
	let regexRuleCount = 0;

	for (const list of ["include", "exclude"] as const) {
		for (const [index, rule] of (filters?.[list] ?? []).entries()) {
			if (!isRegexRule(rule)) continue;
			regexRuleCount += 1;
			if (regexRuleCount > SAFE_PATTERN_LIMITS.regexRules) {
				issues.push({
					list,
					index,
					message: "Regular expression rule budget exceeded.",
				});
				continue;
			}
			try {
				compileSafeUserPattern(rule.value, rule.caseSensitive ?? false);
			} catch (error) {
				issues.push({
					list,
					index,
					message: safePatternErrorMessage(error),
				});
			}
		}
	}

	return issues;
}

export function prepareSafePatternFilters<Rule extends SafePatternRule>(
	filters: SafePatternFilters<Rule> | undefined,
	isRegexRule: (rule: Rule) => boolean,
	options: SafePatternRuntimeOptions = {},
): PreparedSafePatternFilters<Rule> {
	const include = filters?.include ?? [];
	const exclude = filters?.exclude ?? [];
	const regexRuleCount = [...include, ...exclude].filter(isRegexRule).length;
	if (regexRuleCount > SAFE_PATTERN_LIMITS.regexRules) {
		throw new SafeUserPatternError("Regular expression rule budget exceeded.");
	}

	const prepare = (rule: Rule): PreparedSafePatternRule<Rule> => {
		if (!isRegexRule(rule)) return { rule };
		const matcher = compileSafeUserPattern(
			rule.value,
			rule.caseSensitive ?? false,
		);
		options.onPatternCompiled?.();
		return { rule, matcher };
	};

	return {
		include: include.map(prepare),
		exclude: exclude.map(prepare),
	};
}

export function testPreparedSafePattern<Rule extends SafePatternRule>(
	prepared: PreparedSafePatternRule<Rule>,
	candidate: string,
): boolean {
	if (!prepared.matcher) {
		throw new SafeUserPatternError(
			"Regular expression matcher was not prepared.",
		);
	}
	if (utf8Length(candidate) > SAFE_PATTERN_LIMITS.candidateBytes) {
		throw new SafeUserPatternError(
			"Regular expression candidate exceeds the safe size limit.",
		);
	}
	return prepared.matcher.test(candidate);
}

function compileSafeUserPattern(source: string, caseSensitive: boolean): RE2JS {
	if (utf8Length(source) > SAFE_PATTERN_LIMITS.patternBytes) {
		throw new SafeUserPatternError(
			"Regular expression exceeds the safe pattern size limit.",
		);
	}
	if (hasUnsafeRepeatedGroup(source)) {
		throw new SafeUserPatternError(
			"Regular expression uses an unsupported repeated-group form.",
		);
	}

	try {
		return RE2JS.compile(source, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
	} catch {
		throw new SafeUserPatternError(
			"Regular expression uses unsupported or malformed syntax.",
		);
	}
}

function safePatternErrorMessage(error: unknown): string {
	return error instanceof SafeUserPatternError
		? error.message
		: "Regular expression violates the safe pattern contract.";
}

function utf8Length(value: string): number {
	return encoder.encode(value).byteLength;
}

type GroupState = {
	start: number;
	hasQuantifier: boolean;
};

function hasUnsafeRepeatedGroup(source: string): boolean {
	const groups: GroupState[] = [];
	let inCharacterClass = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "[") {
			inCharacterClass = true;
			continue;
		}
		if (char === "]" && inCharacterClass) {
			inCharacterClass = false;
			continue;
		}
		if (inCharacterClass) continue;

		if (char === "(") {
			groups.push({ start: index, hasQuantifier: false });
			continue;
		}
		if (char === ")" && groups.length > 0) {
			const group = groups.pop() as GroupState;
			const repeatsGroup = quantifierLengthAt(source, index + 1) > 0;
			const body = source.slice(group.start + 1, index).replace(/^\?:/, "");
			if (
				repeatsGroup &&
				(group.hasQuantifier || hasAmbiguousTopLevelAlternation(body))
			) {
				return true;
			}
			if (groups.length > 0 && (group.hasQuantifier || repeatsGroup)) {
				groups[groups.length - 1].hasQuantifier = true;
			}
			continue;
		}
		if (char === "?" && index > 0 && source[index - 1] === "(") {
			continue;
		}

		const quantifierLength = quantifierLengthAt(source, index);
		if (quantifierLength > 0) {
			if (groups.length > 0) {
				groups[groups.length - 1].hasQuantifier = true;
			}
			index += quantifierLength - 1;
		}
	}

	return false;
}

function quantifierLengthAt(source: string, index: number): number {
	const char = source[index];
	if (char === "*" || char === "+" || char === "?") return 1;
	if (char !== "{") return 0;
	const end = source.indexOf("}", index + 1);
	if (end < 0) return 0;
	const body = source.slice(index + 1, end);
	return /^\d+(?:,\d*)?$/.test(body) ? end - index + 1 : 0;
}

function hasAmbiguousTopLevelAlternation(body: string): boolean {
	const alternatives = splitTopLevelAlternatives(body);
	for (let left = 0; left < alternatives.length; left += 1) {
		for (let right = left + 1; right < alternatives.length; right += 1) {
			if (
				alternatives[left].startsWith(alternatives[right]) ||
				alternatives[right].startsWith(alternatives[left])
			) {
				return true;
			}
		}
	}
	return false;
}

function splitTopLevelAlternatives(body: string): string[] {
	const alternatives: string[] = [];
	let start = 0;
	let depth = 0;
	let inCharacterClass = false;

	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "[") {
			inCharacterClass = true;
			continue;
		}
		if (char === "]" && inCharacterClass) {
			inCharacterClass = false;
			continue;
		}
		if (inCharacterClass) continue;
		if (char === "(") depth += 1;
		if (char === ")") depth = Math.max(0, depth - 1);
		if (char === "|" && depth === 0) {
			alternatives.push(body.slice(start, index));
			start = index + 1;
		}
	}

	if (alternatives.length === 0) return [];
	alternatives.push(body.slice(start));
	return alternatives;
}

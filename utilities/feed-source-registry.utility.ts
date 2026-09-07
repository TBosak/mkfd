/**
 * The source-definition registry: one authoritative declaration per feed
 * source type.
 *
 * Before this existed, everything a source type implies was scattered as
 * string literals — 51 `feedType === "..."` comparisons across six files,
 * including a sixteen-branch chain in `workers/feed-updater.worker.ts` and
 * another in `utilities/preview-generator.utility.ts`. Those two were separate
 * hand-maintained lists of the same knowledge and had already drifted. Adding
 * a thirteenth type meant editing six files correctly, with nothing failing if
 * you missed one.
 *
 * The union in `models/feed-config.model.ts` stays the authority on config
 * *shape*; this registry is the authority on what a type can *do*. The
 * `Record<FeedType, FeedSourceDefinition>` annotation below ties them
 * together: a union member with no entry, or an entry outside the union, is a
 * type error rather than a runtime surprise.
 *
 * Placed in `utilities/` rather than `models/` because it holds behaviour —
 * preview handlers are functions on the entry — following the precedent set
 * by `utilities/service-connector-registry.utility.ts`.
 */

import type { FeedType } from "../models/feed-config.model";

/** What a feed source type declares about itself. */
export interface FeedSourceDefinition {
	/** The discriminator, identical to the key it is stored under. */
	type: string;
	/** Config schema version for this source's own block. */
	schemaVersion: number;
	/**
	 * False for a type that is declared but not built yet. Registered honestly
	 * as a stub rather than omitted, so it cannot look supported.
	 */
	implemented: boolean;
	/** Whether `generatePreview` can render this type. */
	previewSupported: boolean;
	/**
	 * Config paths within this source's block whose values are secrets. The
	 * masking and resolution paths consult this instead of their own lists.
	 */
	protectedFields: string[];
	/** Output formats this source can produce. */
	outputCapabilities: string[];
	/**
	 * The config key holding this source's own block, when it differs from the
	 * type id. Only `webhook` does today — its block is `webhookFeed` — and
	 * that single exception is exactly what a scattered `config[feedType]`
	 * lookup got wrong: the normalizer silently dropped the whole block on
	 * every save/load round trip, losing the feed's slug and token hash.
	 */
	sourceBlock?: string;
	/**
	 * Optional preview handler. Types registered at runtime supply their own;
	 * the built-in types are dispatched by `preview-generator` today, which
	 * keeps this slice a reorganisation rather than a rewrite of every branch.
	 */
	executePreview?: (feedConfig: FeedSourcePreviewInput) => Promise<import("feed").Feed>;
}

/**
 * What a preview handler receives: the feed's identity plus whatever else its
 * own config block carries.
 *
 * Deliberately not `any` — the locked anti-bypass gate counts `noExplicitAny`
 * diagnostics and does not let them grow, and it was right to catch the first
 * draft of this signature.
 */
export interface FeedSourcePreviewInput {
	feedId: string;
	feedName: string;
	[key: string]: unknown;
}

/** Shorthand for the common case: RSS/Atom/JSON from the canonical builder. */
const ALL_OUTPUTS = ["rss2", "atom1", "json1"];

/**
 * The registry.
 *
 * Annotated `Record<FeedType, FeedSourceDefinition>` deliberately: that is the
 * compile-time half of the union/registry agreement. Adding a member to the
 * union without adding it here fails `bun run typecheck`.
 */
export const FEED_SOURCE_REGISTRY: Record<FeedType, FeedSourceDefinition> = {
	webScraping: {
		type: "webScraping",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: ["headers", "cookies", "config.request.body"],
		outputCapabilities: ALL_OUTPUTS,
	},
	rest: {
		type: "rest",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: ["headers", "cookies", "config.request.body"],
		outputCapabilities: ALL_OUTPUTS,
	},
	api: {
		type: "api",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: ["headers", "cookies", "config.request.body"],
		outputCapabilities: ALL_OUTPUTS,
	},
	email: {
		type: "email",
		schemaVersion: 1,
		implemented: true,
		// No preview branch exists for email today; declared rather than
		// discovered by falling off the end of an if/else chain.
		previewSupported: false,
		protectedFields: ["email.password", "email.user"],
		outputCapabilities: ALL_OUTPUTS,
	},
	graphql: {
		type: "graphql",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: ["graphql.headers"],
		outputCapabilities: ALL_OUTPUTS,
	},
	calendar: {
		type: "calendar",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: [],
		outputCapabilities: ALL_OUTPUTS,
	},
	sitemap: {
		type: "sitemap",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: [],
		outputCapabilities: ALL_OUTPUTS,
	},
	filesystem: {
		type: "filesystem",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: [],
		outputCapabilities: ALL_OUTPUTS,
	},
	webhook: {
		type: "webhook",
		schemaVersion: 1,
		sourceBlock: "webhookFeed",
		implemented: true,
		previewSupported: true,
		protectedFields: [],
		outputCapabilities: ALL_OUTPUTS,
	},
	feedTransformer: {
		type: "feedTransformer",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: ["headers", "cookies"],
		outputCapabilities: ALL_OUTPUTS,
	},
	serviceConnector: {
		type: "serviceConnector",
		schemaVersion: 1,
		implemented: true,
		previewSupported: true,
		protectedFields: [
			"serviceConnector.connection.settings.apiKey",
			"serviceConnector.connection.settings.password",
			"serviceConnector.connection.settings.token",
		],
		outputCapabilities: ALL_OUTPUTS,
	},
	changeDetection: {
		type: "changeDetection",
		schemaVersion: 1,
		// A stub. Its config type is `Record<string, unknown>` and no runtime
		// branch executes it. Declared as unimplemented rather than left out,
		// so nothing can mistake an entry for support.
		implemented: false,
		previewSupported: false,
		protectedFields: [],
		outputCapabilities: [],
	},
};

/** Types registered at runtime, kept apart from the built-in table. */
const runtimeDefinitions = new Map<string, FeedSourceDefinition>();

/**
 * Registers a source type at runtime.
 *
 * This is what makes "adding a source type touches one place" a checkable
 * claim rather than an assertion in a comment: a type registered here routes
 * end to end with no other file edited.
 */
export function registerFeedSourceType(definition: FeedSourceDefinition): void {
	// Silently overwriting would make the registry stop being authoritative:
	// two registrations for one name means the winner depends on import order,
	// and replacing a built-in would swap out a real handler with no signal.
	if (definition.type in FEED_SOURCE_REGISTRY) {
		throw new Error(
			`Cannot register feed source type "${definition.type}": it is one of the built-in types ` +
				"declared in FEED_SOURCE_REGISTRY. Edit that declaration instead of shadowing it.",
		);
	}
	if (runtimeDefinitions.has(definition.type)) {
		throw new Error(
			`Feed source type "${definition.type}" is already registered. Unregister it first if ` +
				"replacing it is genuinely intended.",
		);
	}
	runtimeDefinitions.set(definition.type, definition);
}

/** Removes a runtime registration. Built-in types cannot be unregistered. */
export function unregisterFeedSourceType(type: string): void {
	runtimeDefinitions.delete(type);
}

/**
 * Returns the definition for a type, or `undefined` if it is not registered.
 *
 * Callers treat `undefined` as a refusal. That is the point: an unknown type
 * must be refused explicitly rather than falling through a chain of string
 * comparisons to whatever the last `else` happens to do.
 */
export function getFeedSourceDefinition(type: string): FeedSourceDefinition | undefined {
	return runtimeDefinitions.get(type) ?? (FEED_SOURCE_REGISTRY as Record<string, FeedSourceDefinition>)[type];
}

/** Every registered type, built-in and runtime. */
export function listFeedSourceTypes(): string[] {
	return [...new Set([...Object.keys(FEED_SOURCE_REGISTRY), ...runtimeDefinitions.keys()])];
}

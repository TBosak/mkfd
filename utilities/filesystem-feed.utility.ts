import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Dirent } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import * as yaml from "js-yaml";
import {
	createFilesystemStateStore,
	getDb,
	type FilesystemStateRow,
	type FilesystemStateStore,
} from "../lib/analytics/db";
import type {
	FilesystemFeedConfig,
	FilesystemFeedItem,
	FilesystemScanResult,
	FilesystemSidecarMetadata,
} from "../models/filesystem.model";

const DEFAULT_STATE_DIR = join(__dirname, "../feed-state/filesystem");
const HARD_LIMITS = {
	maxDepth: 32,
	maxVisitedEntries: 10_000,
	maxMatchedFiles: 10_000,
	maxTotalBytes: 64 * 1024 * 1024,
	maxElapsedMs: 30_000,
	maxSidecarBytes: 64 * 1024,
	maxSidecarDepth: 8,
	maxSidecarNodes: 1_024,
	maxFileBytes: 5 * 1024 * 1024,
	maxExtractionCharacters: 20_000,
} as const;
const MAX_ITEMS = 10_000;
const MAX_PATTERNS = 100;
const MAX_PATTERN_BYTES = 256;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type FilesystemLimitOptions = Partial<Record<keyof typeof HARD_LIMITS, number>>;
type FilesystemOperationSeams = {
	beforeOpen?: (path: string) => void | Promise<void>;
	readFile?: (path: string) => unknown | Promise<unknown>;
	onRead?: (kind: string, path: string, requestedBytes: number) => void;
};

export type FilesystemScanOptions = {
	clock?: () => Date;
	now?: () => number;
	signal?: AbortSignal;
	stateStore?: FilesystemStateStore;
	stateDir?: string;
	fs?: FilesystemOperationSeams;
	limits?: FilesystemLimitOptions;
};

export class FilesystemScanError extends Error {
	readonly code: string;
	readonly counters: Record<string, number>;

	constructor(code: string, counters: Record<string, number> = {}) {
		super("Filesystem feed operation could not be completed.");
		this.name = "FilesystemScanError";
		this.code = code;
		this.counters = { ...counters };
	}
}

function filesystemFailure(
	code: string,
	counters: Record<string, number> = {},
): FilesystemScanError {
	return new FilesystemScanError(code, counters);
}

/** Compatibility helper. Runtime authorization uses canonical real paths below. */
export function resolveSafeFilesystemPath(
	inputPath: string,
	allowedRoot: string,
): string {
	const root = resolve(allowedRoot);
	const candidate = resolve(inputPath);
	if (!isWithin(candidate, root)) {
		throw filesystemFailure("FILESYSTEM_ROOT_OUTSIDE");
	}
	return candidate;
}

export async function authorizeFilesystemFeedRoot(
	inputPath: string,
	approvedRoots: string | string[],
): Promise<string> {
	const roots = Array.isArray(approvedRoots) ? approvedRoots : [approvedRoots];
	if (
		typeof inputPath !== "string" ||
		inputPath.length === 0 ||
		roots.length === 0
	) {
		throw filesystemFailure("FILESYSTEM_ROOT_INVALID");
	}
	try {
		const canonicalRoots: string[] = [];
		for (const root of roots) {
			if (typeof root !== "string" || root.length === 0) continue;
			const canonicalRoot = await realpath(root);
			if (!(await stat(canonicalRoot)).isDirectory()) continue;
			canonicalRoots.push(canonicalRoot);
		}
		if (canonicalRoots.length === 0) {
			throw filesystemFailure("FILESYSTEM_ROOT_MISSING");
		}
		const canonicalCandidate = await realpath(inputPath);
		if (!(await stat(canonicalCandidate)).isDirectory()) {
			throw filesystemFailure("FILESYSTEM_ROOT_NOT_DIRECTORY");
		}
		if (!canonicalRoots.some((root) => isWithin(canonicalCandidate, root))) {
			throw filesystemFailure("FILESYSTEM_ROOT_OUTSIDE");
		}
		return canonicalCandidate;
	} catch (error) {
		if (error instanceof FilesystemScanError) throw error;
		throw filesystemFailure("FILESYSTEM_ROOT_MISSING");
	}
}

export function normalizeFilesystemFeedConfig(
	input: unknown,
): FilesystemFeedConfig {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
	}
	const config = input as FilesystemFeedConfig;
	if (typeof config.rootPath !== "string" || config.rootPath.length === 0) {
		throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
	}
	if (!Number.isInteger(config.maxItems) || config.maxItems <= 0) {
		throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
	}
	const include = normalizePatterns(config.include);
	const exclude = normalizePatterns(config.exclude);
	let extraction = config.extraction;
	if (extraction?.enabled) {
		if (
			!Number.isInteger(extraction.maxCharacters) ||
			extraction.maxCharacters <= 0 ||
			!Number.isInteger(extraction.maxFileSizeBytes) ||
			extraction.maxFileSizeBytes <= 0 ||
			!Array.isArray(extraction.supportedExtensions) ||
			extraction.supportedExtensions.some(
				(extension) => typeof extension !== "string" || extension.length === 0,
			)
		) {
			throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
		}
		extraction = {
			...extraction,
			maxCharacters: Math.min(
				extraction.maxCharacters,
				HARD_LIMITS.maxExtractionCharacters,
			),
			maxFileSizeBytes: Math.min(
				extraction.maxFileSizeBytes,
				HARD_LIMITS.maxFileBytes,
			),
			supportedExtensions: [...extraction.supportedExtensions],
		};
	}
	return {
		...config,
		include,
		exclude,
		maxItems: Math.min(config.maxItems, MAX_ITEMS),
		...(extraction ? { extraction } : {}),
	};
}

export async function saveFilesystemFeedConfig(
	id: string,
	config: unknown,
	options: { configDir: string; approvedRoots: string[] },
): Promise<void> {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) {
		throw filesystemFailure("FILESYSTEM_CONFIG_ID_INVALID");
	}
	if (!config || typeof config !== "object") {
		throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
	}
	const value = config as Record<string, unknown>;
	const filesystemConfig = normalizeFilesystemFeedConfig(value.filesystem);
	const canonicalRoot = await authorizeFilesystemFeedRoot(
		filesystemConfig.rootPath,
		options.approvedRoots,
	);
	const persisted = {
		...value,
		filesystem: { ...filesystemConfig, rootPath: canonicalRoot },
	};
	await mkdir(options.configDir, { recursive: true });
	await writeFile(
		join(options.configDir, `${id}.yaml`),
		yaml.dump(persisted),
		"utf8",
	);
}

export function matchesGlob(path: string, patterns: string[]): boolean {
	if (!patterns.length) return true;
	return patterns.some((pattern) => {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		return new RegExp(`(^|/)${escaped}$`).test(path);
	});
}

export async function scanFilesystemFeed(
	inputConfig: FilesystemFeedConfig,
	approvedRoot: string | string[] = approvedRootsFromEnvironment(),
	feedId = "preview",
	options: FilesystemScanOptions = {},
): Promise<FilesystemScanResult> {
	const config = normalizeFilesystemFeedConfig(inputConfig);
	const limits = normalizeLimits(options.limits);
	const stats = {
		scannedFiles: 0,
		matchedFiles: 0,
		excludedFiles: 0,
		skippedDirectories: 0,
		skippedSymlinks: 0,
		sidecarFilesRead: 0,
		sidecarFilesFailed: 0,
	};
	const counters = stats as Record<string, number>;
	const monotonicNow = options.now ?? (() => performance.now());
	const startedAt = monotonicNow();
	const checkpoint = (): void => {
		if (options.signal?.aborted) {
			throw filesystemFailure("FILESYSTEM_CANCELLED", counters);
		}
		if (monotonicNow() - startedAt > limits.maxElapsedMs) {
			throw filesystemFailure("FILESYSTEM_TIMEOUT", counters);
		}
	};

	checkpoint();
	const rootPath = await authorizeFilesystemFeedRoot(
		config.rootPath,
		approvedRoot,
	);
	checkpoint();

	const ownedStore = options.stateStore
		? undefined
		: createDefaultFilesystemStore(options.stateDir ?? DEFAULT_STATE_DIR);
	const stateStore = options.stateStore ?? ownedStore?.store;
	if (!stateStore)
		throw filesystemFailure("FILESYSTEM_STATE_UNAVAILABLE", counters);

	try {
		const priorRows = await stateStore.read(feedId);
		const prior = new Map(priorRows.map((row) => [row.relativePath, row]));
		const warnings: string[] = [];
		const observations: FilesystemStateRow[] = [];
		const items: FilesystemFeedItem[] = [];
		const clock = options.clock ?? (() => new Date());
		const observedAt = clock();
		let totalBytes = 0;

		const fail = (code: string): never => {
			throw filesystemFailure(code, counters);
		};

		const wrapUnsafe = (error: unknown): never => {
			if (error instanceof FilesystemScanError) throw error;
			const code =
				typeof error === "object" && error !== null && "code" in error
					? String((error as { code: unknown }).code)
					: "";
			if (/RACE/i.test(code)) fail("FILESYSTEM_RACE");
			if (/CANCEL/i.test(code)) fail("FILESYSTEM_CANCELLED");
			return fail("FILESYSTEM_UNSAFE_IO");
		};

		const secureStat = async (path: string) => {
			checkpoint();
			try {
				const initial = await lstat(path);
				if (initial.isSymbolicLink()) fail("FILESYSTEM_RACE");
				await options.fs?.beforeOpen?.(path);
				const current = await lstat(path);
				const canonical = await realpath(path);
				if (
					!current.isFile() ||
					current.isSymbolicLink() ||
					initial.dev !== current.dev ||
					initial.ino !== current.ino ||
					!isWithin(canonical, rootPath)
				) {
					fail("FILESYSTEM_RACE");
				}
				return current;
			} catch (error) {
				return wrapUnsafe(error);
			}
		};

		const readBounded = async (
			path: string,
			kind: "content" | "sidecar",
			maximumBytes: number,
		): Promise<Buffer | null> => {
			checkpoint();
			let fileStat: Awaited<ReturnType<typeof lstat>>;
			try {
				fileStat = await lstat(path);
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code: unknown }).code)
						: "";
				if (kind === "sidecar" && code === "ENOENT") return null;
				return wrapUnsafe(error);
			}
			if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
				if (kind === "sidecar") return null;
				fail("FILESYSTEM_RACE");
			}
			if (fileStat.size > maximumBytes) {
				if (kind === "sidecar") return null;
				fail("FILESYSTEM_FILE_BYTES_LIMIT");
			}
			if (totalBytes + fileStat.size > limits.maxTotalBytes) {
				fail("FILESYSTEM_TOTAL_BYTES_LIMIT");
			}
			try {
				await options.fs?.beforeOpen?.(path);
				const canonical = await realpath(path);
				if (!isWithin(canonical, rootPath)) fail("FILESYSTEM_RACE");
				options.fs?.onRead?.(kind, path, fileStat.size);
				let bytes: Buffer;
				if (options.fs?.readFile) {
					const value = await options.fs.readFile(path);
					bytes = Buffer.isBuffer(value)
						? value
						: Buffer.from(
								typeof value === "string" ? value : String(value ?? ""),
								"utf8",
							);
				} else {
					const noFollow =
						typeof fsConstants.O_NOFOLLOW === "number"
							? fsConstants.O_NOFOLLOW
							: 0;
					const handle = await open(path, fsConstants.O_RDONLY | noFollow);
					try {
						const opened = await handle.stat();
						if (
							opened.dev !== fileStat.dev ||
							opened.ino !== fileStat.ino ||
							opened.size > maximumBytes
						) {
							fail("FILESYSTEM_RACE");
						}
						const buffer = Buffer.alloc(opened.size);
						const result = await handle.read(buffer, 0, opened.size, 0);
						bytes = buffer.subarray(0, result.bytesRead);
					} finally {
						await handle.close();
					}
				}
				if (bytes.byteLength > maximumBytes) {
					if (kind === "sidecar") return null;
					fail("FILESYSTEM_FILE_BYTES_LIMIT");
				}
				if (totalBytes + bytes.byteLength > limits.maxTotalBytes) {
					fail("FILESYSTEM_TOTAL_BYTES_LIMIT");
				}
				totalBytes += bytes.byteLength;
				return bytes;
			} catch (error) {
				return wrapUnsafe(error);
			}
		};

		const readSidecar = async (
			path: string,
		): Promise<FilesystemSidecarMetadata> => {
			const bytes = await readBounded(path, "sidecar", limits.maxSidecarBytes);
			if (!bytes) {
				stats.sidecarFilesFailed += 1;
				warnings.push("FILESYSTEM_SIDECAR_INVALID");
				return {};
			}
			try {
				const parsed: unknown = JSON.parse(bytes.toString("utf8"));
				if (
					!isSafeSidecar(parsed, limits.maxSidecarDepth, limits.maxSidecarNodes)
				) {
					throw new Error("invalid sidecar");
				}
				stats.sidecarFilesRead += 1;
				return parsed as FilesystemSidecarMetadata;
			} catch {
				stats.sidecarFilesFailed += 1;
				warnings.push("FILESYSTEM_SIDECAR_INVALID");
				return {};
			}
		};

		const processFile = async (filePath: string): Promise<void> => {
			const rel = relative(rootPath, filePath).replaceAll("\\", "/");
			stats.scannedFiles += 1;
			if (
				!matchesGlob(rel, config.include.length ? config.include : ["*"]) ||
				(config.exclude.length > 0 && matchesGlob(rel, config.exclude))
			) {
				stats.excludedFiles += 1;
				return;
			}
			stats.matchedFiles += 1;
			if (stats.matchedFiles > limits.maxMatchedFiles) {
				fail("FILESYSTEM_MATCH_LIMIT");
			}
			const fileStat = await secureStat(filePath);
			const extension = extname(filePath).replace(/^\./, "");
			const supportsExtraction = Boolean(
				config.extraction?.enabled &&
					config.extraction.supportedExtensions.some(
						(candidate) => candidate.replace(/^\./, "") === extension,
					),
			);
			let content: Buffer | undefined;
			if (
				(config.guidStrategy === "contentHash" || supportsExtraction) &&
				fileStat.size > HARD_LIMITS.maxFileBytes
			) {
				fail("FILESYSTEM_FILE_BYTES_LIMIT");
			}
			const shouldExtract = Boolean(
				supportsExtraction &&
					config.extraction &&
					fileStat.size <= config.extraction.maxFileSizeBytes,
			);
			if (config.guidStrategy === "contentHash" || shouldExtract) {
				content =
					(await readBounded(filePath, "content", limits.maxFileBytes)) ??
					undefined;
			}

			const existing = prior.get(rel);
			const stableId =
				existing?.stableId ?? createHash("sha256").update(rel).digest("hex");
			const firstSeenAt = existing?.firstSeenAt
				? new Date(existing.firstSeenAt)
				: observedAt;
			const contentHash =
				config.guidStrategy === "contentHash" && content
					? createHash("sha256").update(content).digest("hex")
					: existing?.contentHash;
			const textPreview =
				shouldExtract && content && config.extraction
					? content.toString("utf8").slice(0, config.extraction.maxCharacters)
					: undefined;
			const sidecar = config.sidecar?.enabled
				? await readSidecar(`${filePath}${config.sidecar.extension}`)
				: {};
			const filename = basename(filePath);
			const sidecarDate =
				typeof sidecar.date === "string" ? new Date(sidecar.date) : undefined;
			const pubDate =
				sidecarDate && !Number.isNaN(sidecarDate.getTime())
					? sidecarDate
					: config.dateStrategy === "createdTime"
						? fileStat.birthtime
						: config.dateStrategy === "firstSeen"
							? firstSeenAt
							: config.dateStrategy === "currentRun"
								? observedAt
								: fileStat.mtime;
			const title =
				typeof sidecar.title === "string" &&
				config.titleStrategy === "sidecarTitle"
					? sidecar.title
					: config.titleStrategy === "filenameWithoutExtension"
						? filename.replace(/\.[^.]+$/, "")
						: config.titleStrategy === "relativePath"
							? rel
							: filename;
			const publicUrl = config.publicBaseUrl
				? `${config.publicBaseUrl.replace(/\/$/, "")}/${rel}`
				: typeof sidecar.link === "string"
					? sidecar.link
					: undefined;
			const guid =
				typeof sidecar.guid === "string"
					? sidecar.guid
					: config.guidStrategy === "pathAndModifiedTime"
						? `${rel}:${fileStat.mtimeMs}`
						: config.guidStrategy === "contentHash"
							? (contentHash ?? stableId)
							: config.guidStrategy === "firstSeenId"
								? stableId
								: rel;

			items.push({
				id: stableId,
				absolutePath: filePath,
				relativePath: rel,
				publicUrl,
				filename,
				extension,
				sizeBytes: fileStat.size,
				createdAt: fileStat.birthtime,
				modifiedAt: fileStat.mtime,
				firstSeenAt,
				contentHash,
				title,
				description:
					config.descriptionStrategy === "sidecarDescription" &&
					typeof sidecar.description === "string"
						? sidecar.description
						: config.descriptionStrategy === "textPreview"
							? textPreview
							: config.descriptionStrategy === "fileMetadata"
								? `${rel} (${fileStat.size} bytes)`
								: undefined,
				link: typeof sidecar.link === "string" ? sidecar.link : publicUrl,
				author: typeof sidecar.author === "string" ? sidecar.author : undefined,
				categories: Array.isArray(sidecar.categories)
					? sidecar.categories.filter(
							(category): category is string => typeof category === "string",
						)
					: undefined,
				guid,
				pubDate,
			});
			observations.push({
				relativePath: rel,
				stableId,
				firstSeenAt: firstSeenAt.toISOString(),
				lastSeenAt: observedAt.toISOString(),
				lastModifiedAt: fileStat.mtime.toISOString(),
				sizeBytes: fileStat.size,
				...(contentHash ? { contentHash } : {}),
			});
		};

		const walk = async (directory: string, depth: number): Promise<void> => {
			checkpoint();
			let entries: Dirent[];
			try {
				const before = await lstat(directory);
				if (!before.isDirectory() || before.isSymbolicLink()) {
					fail("FILESYSTEM_RACE");
				}
				const canonicalDirectory = await realpath(directory);
				if (!isWithin(canonicalDirectory, rootPath)) fail("FILESYSTEM_RACE");
				entries = await readdir(directory, { withFileTypes: true });
				const after = await lstat(directory);
				const canonicalAfter = await realpath(directory);
				if (
					!after.isDirectory() ||
					after.isSymbolicLink() ||
					before.dev !== after.dev ||
					before.ino !== after.ino ||
					canonicalAfter !== canonicalDirectory
				) {
					fail("FILESYSTEM_RACE");
				}
			} catch (error) {
				return wrapUnsafe(error);
			}
			entries.sort((left, right) => left.name.localeCompare(right.name));
			for (const entry of entries) {
				checkpoint();
				counters.visitedEntries = (counters.visitedEntries ?? 0) + 1;
				if (counters.visitedEntries > limits.maxVisitedEntries) {
					fail("FILESYSTEM_ENTRY_LIMIT");
				}
				const full = join(directory, entry.name);
				if (entry.isSymbolicLink()) {
					stats.skippedSymlinks += 1;
					continue;
				}
				if (entry.isDirectory()) {
					if (!config.recursive) {
						stats.skippedDirectories += 1;
						continue;
					}
					if (depth + 1 > limits.maxDepth) fail("FILESYSTEM_DEPTH_LIMIT");
					await walk(full, depth + 1);
				} else if (entry.isFile()) {
					await processFile(full);
				}
			}
		};

		await walk(rootPath, 0);
		checkpoint();
		await stateStore.replace(feedId, observations);
		return {
			items: sortItems(items, config.sortOrder).slice(0, config.maxItems),
			warnings,
			stats,
		};
	} finally {
		ownedStore?.close();
	}
}

function createDefaultFilesystemStore(legacyDir: string): {
	store: FilesystemStateStore;
	close: () => void;
} {
	try {
		return {
			store: createFilesystemStateStore(getDb(), { legacyDir }),
			close: () => {},
		};
	} catch {
		const sqlite = new Database(":memory:");
		sqlite.run(`
      CREATE TABLE runtime_migrations (
        id text PRIMARY KEY, name text NOT NULL, applied_at text NOT NULL,
        details_json text
      )
    `);
		sqlite.run(`
      CREATE TABLE filesystem_feed_state (
        feed_id text NOT NULL, relative_path text NOT NULL,
        stable_id text NOT NULL, first_seen_at text NOT NULL,
        last_seen_at text NOT NULL, last_modified_at text NOT NULL,
        size_bytes integer NOT NULL, content_hash text
      )
    `);
		sqlite.run(
			"CREATE UNIQUE INDEX idx_filesystem_feed_state_identity ON filesystem_feed_state(feed_id, relative_path)",
		);
		return {
			store: createFilesystemStateStore(sqlite, { legacyDir }),
			close: () => sqlite.close(),
		};
	}
}

export function approvedRootsFromEnvironment(): string[] {
	const configured = process.env.FILESYSTEM_FEEDS_ROOTS;
	if (configured) {
		const roots = configured
			.split(/[\n,;]/)
			.map((root) => root.trim())
			.filter(Boolean);
		if (roots.length) return roots;
	}
	return [process.env.FILESYSTEM_FEEDS_ROOT ?? process.cwd()];
}

function normalizePatterns(value: unknown): string[] {
	if (!Array.isArray(value) || value.length > MAX_PATTERNS) {
		throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
	}
	return value.map((pattern) => {
		if (
			typeof pattern !== "string" ||
			pattern.length === 0 ||
			Buffer.byteLength(pattern, "utf8") > MAX_PATTERN_BYTES
		) {
			throw filesystemFailure("FILESYSTEM_CONFIG_INVALID");
		}
		return pattern;
	});
}

function normalizeLimits(
	input: FilesystemLimitOptions = {},
): typeof HARD_LIMITS {
	return Object.fromEntries(
		Object.entries(HARD_LIMITS).map(([name, hardLimit]) => {
			const requested = input[name as keyof typeof HARD_LIMITS];
			return [
				name,
				Number.isInteger(requested) && (requested ?? 0) > 0
					? Math.min(requested as number, hardLimit)
					: hardLimit,
			];
		}),
	) as typeof HARD_LIMITS;
}

function isSafeSidecar(
	value: unknown,
	maxDepth: number,
	maxNodes: number,
): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	let nodes = 0;
	const visit = (candidate: unknown, depth: number): boolean => {
		if (!candidate || typeof candidate !== "object") return true;
		if (depth > maxDepth) return false;
		if (Array.isArray(candidate)) {
			for (const item of candidate) {
				nodes += 1;
				if (nodes > maxNodes || !visit(item, depth + 1)) return false;
			}
			return true;
		}
		for (const [key, child] of Object.entries(candidate)) {
			if (FORBIDDEN_JSON_KEYS.has(key)) return false;
			nodes += 1;
			if (nodes > maxNodes || !visit(child, depth + 1)) return false;
		}
		return true;
	};
	return visit(value, 1);
}

function isWithin(candidate: string, root: string): boolean {
	const normalizedCandidate = resolve(candidate);
	const normalizedRoot = resolve(root);
	return (
		normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
	);
}

function sortItems(
	items: FilesystemFeedItem[],
	sortOrder: FilesystemFeedConfig["sortOrder"],
): FilesystemFeedItem[] {
	return [...items].sort((a, b) => {
		if (sortOrder === "filenameAsc")
			return a.filename.localeCompare(b.filename);
		if (sortOrder === "filenameDesc")
			return b.filename.localeCompare(a.filename);
		const at = sortOrder.startsWith("created")
			? (a.createdAt?.getTime() ?? 0)
			: sortOrder === "firstSeenDesc"
				? (a.firstSeenAt?.getTime() ?? 0)
				: (a.modifiedAt?.getTime() ?? 0);
		const bt = sortOrder.startsWith("created")
			? (b.createdAt?.getTime() ?? 0)
			: sortOrder === "firstSeenDesc"
				? (b.firstSeenAt?.getTime() ?? 0)
				: (b.modifiedAt?.getTime() ?? 0);
		return sortOrder.endsWith("Asc") ? at - bt : bt - at;
	});
}

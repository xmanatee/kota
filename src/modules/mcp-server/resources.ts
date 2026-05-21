/**
 * MCP resource definitions and readers for KOTA state.
 *
 * Exposes KOTA's read-only resources over the MCP protocol:
 *   kota://tasks/ready          – task queue snapshot
 *   kota://workflow/status      – runtime state summary
 *   kota://workflow/runs/recent – 10 most recent run summaries
 *   kota://memory               – bounded memory index
 *   kota://knowledge            – bounded knowledge index
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { getKnowledgeProvider, getMemoryProvider } from "#core/modules/provider-registry.js";
import type { KnowledgeEntry, Memory } from "#core/modules/provider-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { getRepoTaskStateDir } from "#modules/repo-tasks/repo-tasks-domain.js";

export type McpResource = {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
};

export type McpResourceTemplate = {
	uriTemplate: string;
	name: string;
	description: string;
	mimeType: string;
};

export type McpResourceListPage = {
	resources: McpResource[];
	nextCursor?: string;
};

export type McpResourceTemplateListPage = {
	resourceTemplates: McpResourceTemplate[];
	nextCursor?: string;
};

type KotaResourceError = { ok: false; code: number; message: string };

export type McpResourceCatalogResult<T> =
	| { ok: true; result: T }
	| KotaResourceError;

export const RESOURCE_LIST_PAGE_SIZE = 3;
export const RESOURCE_TEMPLATE_LIST_PAGE_SIZE = 3;

const CORE_KOTA_RESOURCES: McpResource[] = [
	{
		uri: "kota://tasks/ready",
		name: "Ready Tasks",
		description: "Tasks in data/tasks/ready/ with id, title, priority, and summary.",
		mimeType: "application/json",
	},
	{
		uri: "kota://workflow/status",
		name: "Workflow Status",
		description:
			"Current paused state, active run count, and per-workflow last-run status.",
		mimeType: "application/json",
	},
	{
		uri: "kota://workflow/runs/recent",
		name: "Recent Workflow Runs",
		description: "The 10 most recent workflow run summaries.",
		mimeType: "application/json",
	},
];

const MEMORY_RESOURCE: McpResource = {
	uri: "kota://memory",
	name: "Memory",
	description:
		"Bounded memory index. Read returned readUri values for entry content or use kota://memory/search?q=...",
	mimeType: "application/json",
};

const KNOWLEDGE_RESOURCE: McpResource = {
	uri: "kota://knowledge",
	name: "Knowledge",
	description:
		"Bounded knowledge index. Read returned readUri values for entry content or use kota://knowledge/search?q=...",
	mimeType: "application/json",
};

const MEMORY_RESOURCE_TEMPLATES: McpResourceTemplate[] = [
	{
		uriTemplate: "kota://memory{?cursor,limit}",
		name: "Memory Index",
		description:
			"List bounded memory entries. Use returned readUri values for entry content.",
		mimeType: "application/json",
	},
	{
		uriTemplate: "kota://memory/search{?q,cursor,limit}",
		name: "Memory Search",
		description:
			"Search memory entries by query and return bounded snippets plus readUri values.",
		mimeType: "application/json",
	},
	{
		uriTemplate: "kota://memory/entry/{encodedId}",
		name: "Memory Entry",
		description:
			"Read bounded content for an encoded memory entry id returned by memory index or search.",
		mimeType: "application/json",
	},
];

const KNOWLEDGE_RESOURCE_TEMPLATES: McpResourceTemplate[] = [
	{
		uriTemplate: "kota://knowledge{?cursor,limit}",
		name: "Knowledge Index",
		description:
			"List bounded knowledge entries. Use returned readUri values for entry content.",
		mimeType: "application/json",
	},
	{
		uriTemplate: "kota://knowledge/search{?q,cursor,limit}",
		name: "Knowledge Search",
		description:
			"Search knowledge entries by query and return bounded snippets plus readUri values.",
		mimeType: "application/json",
	},
	{
		uriTemplate: "kota://knowledge/entry/{encodedId}",
		name: "Knowledge Entry",
		description:
			"Read bounded content for an encoded knowledge entry id returned by knowledge index or search.",
		mimeType: "application/json",
	},
];

function hasMemoryProvider(): boolean {
	try {
		getMemoryProvider();
		return true;
	} catch {
		return false;
	}
}

function hasKnowledgeProvider(): boolean {
	try {
		getKnowledgeProvider();
		return true;
	} catch {
		return false;
	}
}

export function listKotaResources(): McpResource[] {
	return [
		...CORE_KOTA_RESOURCES,
		...(hasMemoryProvider() ? [MEMORY_RESOURCE] : []),
		...(hasKnowledgeProvider() ? [KNOWLEDGE_RESOURCE] : []),
	];
}

export function listKotaResourceTemplates(): McpResourceTemplate[] {
	return [
		...(hasMemoryProvider() ? MEMORY_RESOURCE_TEMPLATES : []),
		...(hasKnowledgeProvider() ? KNOWLEDGE_RESOURCE_TEMPLATES : []),
	].map((template) => ({ ...template }));
}

export function isKnownKotaResourceUri(uri: string): boolean {
	return listKotaResources().some((resource) => resource.uri === uri);
}

const INDEX_LIMIT_DEFAULT = 50;
const SEARCH_LIMIT_DEFAULT = 10;
const ENTRY_CONTENT_CHAR_LIMIT = 12_000;
const SNIPPET_CHAR_LIMIT = 240;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export type KotaResourceReadResult =
	| { ok: true; text: string }
	| KotaResourceError;

type CursorScope =
	| "resources-list"
	| "resource-templates-list"
	| "memory-index"
	| "memory-search"
	| "knowledge-index"
	| "knowledge-search";

type Page<T> = {
	items: T[];
	cursor: string | null;
	nextCursor: string | null;
	totalEntries: number;
	limit: number;
};

type BoundedText = {
	text: string;
	truncated: boolean;
	charLimit: number;
	availableChars: number;
};

type MemoryIndexEntry = {
	id: string;
	tags: string[];
	createdAt: string;
	readUri: string;
};

type KnowledgeIndexEntry = {
	id: string;
	title: string;
	type: string;
	status: string;
	tags: string[];
	source: string | null;
	createdAt: string;
	updatedAt: string;
	readUri: string;
};

function resourceSuccess<T>(value: T): KotaResourceReadResult {
	return { ok: true, text: JSON.stringify(value, null, 2) };
}

function catalogSuccess<T>(result: T): McpResourceCatalogResult<T> {
	return { ok: true, result };
}

function protocolError(message: string): KotaResourceError {
	return { ok: false, code: -32602, message };
}

function notFoundError(message: string): KotaResourceError {
	return { ok: false, code: -32002, message };
}

function encodeToken(value: string): string {
	return Buffer.from(value, "utf-8").toString("base64url");
}

function decodeToken(token: string, label: string): string | KotaResourceError {
	if (!OPAQUE_TOKEN_PATTERN.test(token)) return protocolError(`Invalid ${label}`);
	const decoded = Buffer.from(token, "base64url").toString("utf-8");
	if (!decoded || encodeToken(decoded) !== token) return protocolError(`Invalid ${label}`);
	return decoded;
}

function encodeEntryUri(kind: "memory" | "knowledge", id: string): string {
	return `kota://${kind}/entry/${encodeToken(id)}`;
}

function encodeCursor(scope: CursorScope, offset: number): string {
	return encodeToken(`${scope}:${offset}`);
}

function decodeCursor(
	token: string,
	scope: CursorScope,
	label: string,
): number | KotaResourceError {
	const decoded = decodeToken(token, label);
	if (typeof decoded !== "string") return decoded;
	const prefix = `${scope}:`;
	if (!decoded.startsWith(prefix)) return protocolError(`Invalid ${label}`);
	const offsetText = decoded.slice(prefix.length);
	if (!/^(0|[1-9][0-9]*)$/.test(offsetText)) return protocolError(`Invalid ${label}`);
	return Number.parseInt(offsetText, 10);
}

function parseLimit(value: string | null, defaultLimit: number, label: string): number | KotaResourceReadResult {
	if (value === null) return defaultLimit;
	if (!/^(0|[1-9][0-9]*)$/.test(value)) {
		return protocolError(`${label} limit must be an integer from 1 to ${defaultLimit}`);
	}
	const limit = Number.parseInt(value, 10);
	if (limit < 1 || limit > defaultLimit) {
		return protocolError(`${label} limit must be an integer from 1 to ${defaultLimit}`);
	}
	return limit;
}

function paginate<T>(
	items: T[],
	offset: number,
	limit: number,
	cursor: string | null,
	scope: CursorScope,
	label: string,
): Page<T> | KotaResourceError {
	if (offset < 0 || offset > items.length || (cursor !== null && offset === items.length && items.length > 0)) {
		return protocolError(`${label} cursor is out of range`);
	}
	const pageItems = items.slice(offset, offset + limit);
	const nextOffset = offset + pageItems.length;
	const nextCursor = nextOffset < items.length ? encodeCursor(scope, nextOffset) : null;
	return {
		items: pageItems,
		cursor,
		nextCursor,
		totalEntries: items.length,
		limit,
	};
}

function decodeCatalogCursor(
	cursor: KotaJsonValue | undefined,
	scope: CursorScope,
	label: string,
): { ok: true; cursor: string | null; offset: number } | KotaResourceError {
	if (cursor === undefined) return { ok: true, cursor: null, offset: 0 };
	if (typeof cursor !== "string") return protocolError(`Invalid ${label}`);
	const offset = decodeCursor(cursor, scope, label);
	if (typeof offset !== "number") return offset;
	return { ok: true, cursor, offset };
}

function paginateCatalog<T>(
	items: T[],
	cursorValue: KotaJsonValue | undefined,
	limit: number,
	scope: CursorScope,
	label: string,
): McpResourceCatalogResult<{ items: T[]; nextCursor?: string }> {
	const decoded = decodeCatalogCursor(cursorValue, scope, `${label.toLowerCase()} cursor`);
	if (!decoded.ok) return decoded;
	if (
		decoded.offset < 0 ||
		decoded.offset > items.length ||
		(decoded.cursor !== null && decoded.offset === items.length)
	) {
		return protocolError(`${label} cursor is out of range`);
	}
	const pageItems = items.slice(decoded.offset, decoded.offset + limit);
	const nextOffset = decoded.offset + pageItems.length;
	return catalogSuccess({
		items: pageItems,
		...(nextOffset < items.length && { nextCursor: encodeCursor(scope, nextOffset) }),
	});
}

export function listKotaResourcesPage(
	cursor: KotaJsonValue | undefined,
): McpResourceCatalogResult<McpResourceListPage> {
	const page = paginateCatalog(
		listKotaResources(),
		cursor,
		RESOURCE_LIST_PAGE_SIZE,
		"resources-list",
		"Resources",
	);
	if (!page.ok) return page;
	return catalogSuccess({
		resources: page.result.items,
		...(page.result.nextCursor !== undefined && { nextCursor: page.result.nextCursor }),
	});
}

export function listKotaResourceTemplatesPage(
	cursor: KotaJsonValue | undefined,
): McpResourceCatalogResult<McpResourceTemplateListPage> {
	const page = paginateCatalog(
		listKotaResourceTemplates(),
		cursor,
		RESOURCE_TEMPLATE_LIST_PAGE_SIZE,
		"resource-templates-list",
		"Resource templates",
	);
	if (!page.ok) return page;
	return catalogSuccess({
		resourceTemplates: page.result.items,
		...(page.result.nextCursor !== undefined && { nextCursor: page.result.nextCursor }),
	});
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function boundText(value: string, limit: number): BoundedText {
	return {
		text: value.slice(0, limit),
		truncated: value.length > limit,
		charLimit: limit,
		availableChars: value.length,
	};
}

function buildSnippet(content: string, query: string): string {
	const normalized = normalizeWhitespace(content);
	const lowerContent = normalized.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const terms = lowerQuery.split(/\s+/).filter(Boolean);
	let index = lowerContent.indexOf(lowerQuery);
	if (index === -1) {
		const matchingTerm = terms.find((term) => lowerContent.includes(term));
		index = matchingTerm ? lowerContent.indexOf(matchingTerm) : 0;
	}
	const start = Math.max(0, index - 80);
	return normalizeWhitespace(normalized.slice(start, start + SNIPPET_CHAR_LIMIT));
}

function parseKotaUrl(uri: string): URL | KotaResourceReadResult {
	let parsed: URL;
	try {
		parsed = new URL(uri);
	} catch {
		return notFoundError(`Unknown resource: ${uri}`);
	}
	if (parsed.protocol !== "kota:") return notFoundError(`Unknown resource: ${uri}`);
	return parsed;
}

function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return fields;
}

function readReadyTasks(projectDir: string): unknown {
	const dir = getRepoTaskStateDir(projectDir, "ready");
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	const tasks = [];
	for (const file of files) {
		const content = readFileSync(join(dir, file), "utf-8");
		const fm = parseFrontmatter(content);
		if (fm.id && fm.title) {
			tasks.push({
				id: fm.id,
				title: fm.title,
				priority: fm.priority ?? "",
				summary: fm.summary ?? "",
			});
		}
	}
	return tasks;
}

function readWorkflowStatus(projectDir: string): unknown {
	const store = new WorkflowRunStore(projectDir);
	const state = store.readState();
	const perWorkflow: Record<string, unknown> = {};
	for (const [name, ws] of Object.entries(state.workflows)) {
		perWorkflow[name] = {
			lastStarted: ws.lastStarted ?? null,
			lastCompletion: ws.lastCompletion ?? null,
			nextScheduledAt: ws.nextScheduledAt ?? null,
		};
	}
	return {
		activeRunCount: (state.activeRuns ?? []).length,
		paused: !!state.agentBackoff,
		workflows: perWorkflow,
	};
}

function readRecentRuns(projectDir: string): unknown {
	const store = new WorkflowRunStore(projectDir);
	const runs = store.listRuns({ limit: 10 });
	return runs.map((r) => ({
		id: r.id,
		workflow: r.workflow,
		status: r.status,
		totalCostUsd: r.totalCostUsd ?? null,
		durationMs: r.durationMs ?? null,
		startedAt: r.startedAt,
		completedAt: r.completedAt ?? null,
	}));
}

function memoryIndexEntry(entry: Memory): MemoryIndexEntry {
	return {
		id: entry.id,
		tags: entry.tags,
		createdAt: entry.created,
		readUri: encodeEntryUri("memory", entry.id),
	};
}

function readMemoryIndex(parsed: URL): KotaResourceReadResult {
	const provider = getMemoryProvider();
	const entries = provider.list();
	const limit = parseLimit(parsed.searchParams.get("limit"), INDEX_LIMIT_DEFAULT, "memory index");
	if (typeof limit !== "number") return limit;
	const cursor = parsed.searchParams.get("cursor");
	const offset = cursor === null ? 0 : decodeCursor(cursor, "memory-index", "memory cursor");
	if (typeof offset !== "number") return offset;
	const page = paginate(entries, offset, limit, cursor, "memory-index", "Memory index");
	if ("ok" in page) return page;
	return resourceSuccess({
		kind: "memory.index",
		entries: page.items.map(memoryIndexEntry),
		cursor: page.cursor,
		nextCursor: page.nextCursor,
		limit: page.limit,
		totalEntries: page.totalEntries,
		searchUriTemplate: "kota://memory/search?q={query}",
	});
}

function readMemoryEntry(token: string): KotaResourceReadResult {
	const id = decodeToken(token, "memory entry id");
	if (typeof id !== "string") return id;
	const provider = getMemoryProvider();
	const entry = provider.list().find((candidate) => candidate.id === id) ?? null;
	if (!entry) return notFoundError(`Unknown memory entry: ${id}`);
	const content = boundText(entry.content, ENTRY_CONTENT_CHAR_LIMIT);
	return resourceSuccess({
		kind: "memory.entry",
		id: entry.id,
		tags: entry.tags,
		createdAt: entry.created,
		content: content.text,
		contentTruncated: content.truncated,
		contentCharLimit: content.charLimit,
		availableChars: content.availableChars,
	});
}

function readMemorySearch(parsed: URL): KotaResourceReadResult {
	const query = normalizeWhitespace(parsed.searchParams.get("q") ?? "");
	if (!query) return protocolError("Missing required memory search query: q");
	const limit = parseLimit(parsed.searchParams.get("limit"), SEARCH_LIMIT_DEFAULT, "memory search");
	if (typeof limit !== "number") return limit;
	const cursor = parsed.searchParams.get("cursor");
	const offset = cursor === null ? 0 : decodeCursor(cursor, "memory-search", "memory search cursor");
	if (typeof offset !== "number") return offset;
	const provider = getMemoryProvider();
	const entries = provider.search(query);
	const page = paginate(entries, offset, limit, cursor, "memory-search", "Memory search");
	if ("ok" in page) return page;
	return resourceSuccess({
		kind: "memory.search",
		query,
		hits: page.items.map((entry) => ({
			id: entry.id,
			tags: entry.tags,
			createdAt: entry.created,
			snippet: buildSnippet(entry.content, query),
			readUri: encodeEntryUri("memory", entry.id),
		})),
		cursor: page.cursor,
		nextCursor: page.nextCursor,
		limit: page.limit,
		totalHits: page.totalEntries,
	});
}

function knowledgeIndexEntry(entry: KnowledgeEntry): KnowledgeIndexEntry {
	return {
		id: entry.id,
		title: entry.title,
		type: entry.type,
		status: entry.status,
		tags: entry.tags,
		source: entry.meta.source ?? null,
		createdAt: entry.created,
		updatedAt: entry.updated,
		readUri: encodeEntryUri("knowledge", entry.id),
	};
}

function readKnowledgeIndex(parsed: URL): KotaResourceReadResult {
	const provider = getKnowledgeProvider();
	const entries = provider.list();
	const limit = parseLimit(parsed.searchParams.get("limit"), INDEX_LIMIT_DEFAULT, "knowledge index");
	if (typeof limit !== "number") return limit;
	const cursor = parsed.searchParams.get("cursor");
	const offset = cursor === null ? 0 : decodeCursor(cursor, "knowledge-index", "knowledge cursor");
	if (typeof offset !== "number") return offset;
	const page = paginate(entries, offset, limit, cursor, "knowledge-index", "Knowledge index");
	if ("ok" in page) return page;
	return resourceSuccess({
		kind: "knowledge.index",
		entries: page.items.map(knowledgeIndexEntry),
		cursor: page.cursor,
		nextCursor: page.nextCursor,
		limit: page.limit,
		totalEntries: page.totalEntries,
		searchUriTemplate: "kota://knowledge/search?q={query}",
	});
}

function readKnowledgeEntry(token: string): KotaResourceReadResult {
	const id = decodeToken(token, "knowledge entry id");
	if (typeof id !== "string") return id;
	const provider = getKnowledgeProvider();
	const entry = provider.read(id);
	if (!entry) return notFoundError(`Unknown knowledge entry: ${id}`);
	const content = boundText(entry.content, ENTRY_CONTENT_CHAR_LIMIT);
	return resourceSuccess({
		kind: "knowledge.entry",
		id: entry.id,
		title: entry.title,
		type: entry.type,
		status: entry.status,
		tags: entry.tags,
		source: entry.meta.source ?? null,
		createdAt: entry.created,
		updatedAt: entry.updated,
		content: content.text,
		contentTruncated: content.truncated,
		contentCharLimit: content.charLimit,
		availableChars: content.availableChars,
	});
}

function readKnowledgeSearch(parsed: URL): KotaResourceReadResult {
	const query = normalizeWhitespace(parsed.searchParams.get("q") ?? "");
	if (!query) return protocolError("Missing required knowledge search query: q");
	const limit = parseLimit(parsed.searchParams.get("limit"), SEARCH_LIMIT_DEFAULT, "knowledge search");
	if (typeof limit !== "number") return limit;
	const cursor = parsed.searchParams.get("cursor");
	const offset = cursor === null ? 0 : decodeCursor(cursor, "knowledge-search", "knowledge search cursor");
	if (typeof offset !== "number") return offset;
	const provider = getKnowledgeProvider();
	const entries = provider.search(query);
	const page = paginate(entries, offset, limit, cursor, "knowledge-search", "Knowledge search");
	if ("ok" in page) return page;
	return resourceSuccess({
		kind: "knowledge.search",
		query,
		hits: page.items.map((entry) => ({
			id: entry.id,
			title: entry.title,
			type: entry.type,
			status: entry.status,
			tags: entry.tags,
			source: entry.meta.source ?? null,
			createdAt: entry.created,
			updatedAt: entry.updated,
			snippet: buildSnippet(entry.content, query),
			readUri: encodeEntryUri("knowledge", entry.id),
		})),
		cursor: page.cursor,
		nextCursor: page.nextCursor,
		limit: page.limit,
		totalHits: page.totalEntries,
	});
}

function readMemoryResource(parsed: URL): KotaResourceReadResult {
	if (parsed.pathname === "" || parsed.pathname === "/") return readMemoryIndex(parsed);
	if (parsed.pathname === "/search") return readMemorySearch(parsed);
	const entryMatch = parsed.pathname.match(/^\/entry\/([^/]+)$/);
	if (entryMatch) return readMemoryEntry(entryMatch[1]);
	return notFoundError(`Unknown resource: ${parsed.toString()}`);
}

function readKnowledgeResource(parsed: URL): KotaResourceReadResult {
	if (parsed.pathname === "" || parsed.pathname === "/") return readKnowledgeIndex(parsed);
	if (parsed.pathname === "/search") return readKnowledgeSearch(parsed);
	const entryMatch = parsed.pathname.match(/^\/entry\/([^/]+)$/);
	if (entryMatch) return readKnowledgeEntry(entryMatch[1]);
	return notFoundError(`Unknown resource: ${parsed.toString()}`);
}

/**
 * Read the content for a known resource URI.
 * Returns an MCP error envelope if the URI is not recognized.
 */
export function readKotaResource(
	uri: string,
	projectDir: string,
): KotaResourceReadResult {
	switch (uri) {
		case "kota://tasks/ready":
			return resourceSuccess(readReadyTasks(projectDir));
		case "kota://workflow/status":
			return resourceSuccess(readWorkflowStatus(projectDir));
		case "kota://workflow/runs/recent":
			return resourceSuccess(readRecentRuns(projectDir));
	}
	const parsed = parseKotaUrl(uri);
	if ("ok" in parsed) return parsed;
	if (parsed.hostname === "memory") {
		if (!hasMemoryProvider()) return notFoundError(`Unknown resource: ${uri}`);
		return readMemoryResource(parsed);
	}
	if (parsed.hostname === "knowledge") {
		if (!hasKnowledgeProvider()) return notFoundError(`Unknown resource: ${uri}`);
		return readKnowledgeResource(parsed);
	}
	return notFoundError(`Unknown resource: ${uri}`);
}

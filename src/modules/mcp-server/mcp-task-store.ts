import { randomUUID } from "node:crypto";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type {
	JsonRpcErrorObject,
	McpCreateTaskResult,
	McpInputRequiredResult,
	McpStoredTaskTerminalResult,
	McpTask,
	McpTaskListPage,
	McpTaskResultSettlement,
	McpTaskStatus,
	McpTaskTerminalStatus,
} from "./mcp-protocol-types.js";

export type McpTaskStoreOptions = {
	now?: () => Date;
	generateTaskId?: () => string;
	defaultTtlMs?: number;
	pollIntervalMs?: number;
	pageSize?: number;
};

export type CreateMcpTaskOptions = {
	requestedTtlMs?: number;
	pollIntervalMs?: number;
	statusMessage?: string;
};

export type McpTaskTransition =
	| {
			status: "working";
			statusMessage?: string;
		}
	| {
			status: "input_required";
			inputRequired: McpInputRequiredResult;
			statusMessage?: string;
		};

export type McpTaskTerminalOptions = {
	statusMessage?: string;
};

export type CancelMcpTaskOptions = McpTaskTerminalOptions & {
	terminalResult?: McpStoredTaskTerminalResult;
};

export type McpTaskListOptions = {
	cursor?: string;
	limit?: number;
};

type ClockReading = {
	ms: number;
	iso: string;
};

type Waiter = {
	resolve: (settlement: McpTaskResultSettlement) => void;
	reject: (err: Error) => void;
};

type StoredTask = {
	task: McpTask;
	createdAtMs: number;
	expiresAtMs: number;
	sequence: number;
	terminal?: McpStoredTaskTerminalResult;
	inputRequired?: McpInputRequiredResult;
	waiters: Waiter[];
};

type NonTerminalMcpTaskStatus = Exclude<McpTaskStatus, McpTaskTerminalStatus>;

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_ID_GENERATION_ATTEMPTS = 100;

const VALID_TRANSITIONS = {
	working: ["input_required", "completed", "failed", "cancelled"],
	input_required: ["working", "completed", "failed", "cancelled"],
} satisfies Record<NonTerminalMcpTaskStatus, readonly McpTaskStatus[]>;

export class McpTaskStore {
	readonly #now: () => Date;
	readonly #generateTaskId: () => string;
	readonly #defaultTtlMs: number;
	readonly #pollIntervalMs: number;
	readonly #pageSize: number;
	readonly #tasks = new Map<string, StoredTask>();
	#nextSequence = 0;

	constructor(options: McpTaskStoreOptions = {}) {
		this.#now = options.now ?? (() => new Date());
		this.#generateTaskId = options.generateTaskId ?? (() => `task-${randomUUID()}`);
		this.#defaultTtlMs = requirePositiveInteger(
			options.defaultTtlMs ?? DEFAULT_TTL_MS,
			"defaultTtlMs",
		);
		this.#pollIntervalMs = requirePositiveInteger(
			options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			"pollIntervalMs",
		);
		this.#pageSize = requirePositiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, "pageSize");
	}

	create(options: CreateMcpTaskOptions = {}): McpCreateTaskResult {
		this.expire();
		const created = this.#readClock();
		const ttl = requirePositiveInteger(
			options.requestedTtlMs ?? this.#defaultTtlMs,
			"requestedTtlMs",
		);
		const pollInterval = requirePositiveInteger(
			options.pollIntervalMs ?? this.#pollIntervalMs,
			"pollIntervalMs",
		);
		const task: McpTask = {
			taskId: this.#nextTaskId(),
			status: "working",
			createdAt: created.iso,
			lastUpdatedAt: created.iso,
			ttl,
			pollInterval,
			...(options.statusMessage !== undefined && { statusMessage: options.statusMessage }),
		};
		this.#tasks.set(task.taskId, {
			task,
			createdAtMs: created.ms,
			expiresAtMs: created.ms + ttl,
			sequence: this.#nextSequence,
			waiters: [],
		});
		this.#nextSequence += 1;
		return { task: cloneTask(task) };
	}

	read(taskId: string): McpTask {
		this.expire();
		return cloneTask(this.#requireTask(taskId).task);
	}

	transition(taskId: string, transition: McpTaskTransition): McpTask {
		this.expire();
		const stored = this.#requireTask(taskId);
		this.#assertTransitionAllowed(stored, transition.status);
		const clock = this.#readClock();
		if (transition.status === "input_required") {
			assertInputRequiredResult(transition.inputRequired);
			const inputRequired = cloneInputRequired(transition.inputRequired);
			stored.inputRequired = inputRequired;
			this.#updateTask(stored, transition.status, clock, transition.statusMessage);
			this.#settleWaiters(stored, {
				kind: "input_required",
				task: cloneTask(stored.task),
				inputRequired,
			});
			return cloneTask(stored.task);
		}
		stored.inputRequired = undefined;
		this.#updateTask(stored, transition.status, clock, transition.statusMessage);
		return cloneTask(stored.task);
	}

	complete(
		taskId: string,
		result: KotaJsonValue,
		options: McpTaskTerminalOptions = {},
	): McpTask {
		return this.#settleTerminal(
			taskId,
			"completed",
			{ kind: "result", result },
			options.statusMessage,
		);
	}

	fail(
		taskId: string,
		error: JsonRpcErrorObject,
		options: McpTaskTerminalOptions = {},
	): McpTask {
		assertJsonRpcErrorObject(error);
		return this.#settleTerminal(taskId, "failed", { kind: "error", error }, options.statusMessage);
	}

	cancel(taskId: string, options: CancelMcpTaskOptions = {}): McpTask {
		const terminalResult = options.terminalResult ?? {
			kind: "error" as const,
			error: { code: -32800, message: options.statusMessage ?? "Task cancelled" },
		};
		assertTerminalResult(terminalResult);
		return this.#settleTerminal(
			taskId,
			"cancelled",
			terminalResult,
			options.statusMessage ?? "Task cancelled",
		);
	}

	waitForResult(taskId: string): Promise<McpTaskResultSettlement> {
		this.expire();
		const stored = this.#requireTask(taskId);
		const settlement = taskSettlement(stored);
		if (settlement) return Promise.resolve(settlement);
		return new Promise((resolve, reject) => {
			stored.waiters.push({ resolve, reject });
		});
	}

	expire(): string[] {
		const now = this.#readClock();
		const expired: string[] = [];
		for (const [taskId, stored] of this.#tasks) {
			if (now.ms < stored.expiresAtMs) continue;
			expired.push(taskId);
			this.#tasks.delete(taskId);
			const err = new Error(`MCP task "${taskId}" expired`);
			for (const waiter of stored.waiters.splice(0)) {
				waiter.reject(err);
			}
		}
		return expired;
	}

	listPage(options: McpTaskListOptions = {}): McpTaskListPage {
		this.expire();
		const entries = [...this.#tasks.values()].sort((left, right) => left.sequence - right.sequence);
		const start = options.cursor ? decodeCursor(options.cursor) : 0;
		if (start > entries.length) {
			throw new Error("Invalid MCP task cursor: cursor is past the end of the task list");
		}
		const limit = requirePositiveInteger(options.limit ?? this.#pageSize, "limit");
		const tasks = entries.slice(start, start + limit).map((entry) => cloneTask(entry.task));
		const nextOffset = start + tasks.length;
		return {
			tasks,
			...(nextOffset < entries.length && { nextCursor: encodeCursor(nextOffset) }),
		};
	}

	#settleTerminal(
		taskId: string,
		status: McpTaskTerminalStatus,
		terminal: McpStoredTaskTerminalResult,
		statusMessage?: string,
	): McpTask {
		this.expire();
		const stored = this.#requireTask(taskId);
		this.#assertTransitionAllowed(stored, status);
		assertTerminalResult(terminal);
		const terminalResult = cloneTerminalResult(terminal);
		stored.terminal = terminalResult;
		stored.inputRequired = undefined;
		this.#updateTask(stored, status, this.#readClock(), statusMessage);
		this.#settleWaiters(stored, {
			kind: "terminal",
			task: cloneTask(stored.task),
			terminal: terminalResult,
		});
		return cloneTask(stored.task);
	}

	#assertTransitionAllowed(stored: StoredTask, nextStatus: McpTaskStatus): void {
		const current = stored.task.status;
		if (current !== "working" && current !== "input_required") {
			throw new Error(
				`Cannot transition MCP task "${stored.task.taskId}" from terminal state "${current}"`,
			);
		}
		const allowed: readonly McpTaskStatus[] = VALID_TRANSITIONS[current];
		if (!allowed.includes(nextStatus)) {
			throw new Error(`Invalid MCP task transition: ${current} -> ${nextStatus}`);
		}
	}

	#settleWaiters(stored: StoredTask, settlement: McpTaskResultSettlement): void {
		for (const waiter of stored.waiters.splice(0)) {
			waiter.resolve(cloneSettlement(settlement));
		}
	}

	#updateTask(
		stored: StoredTask,
		status: McpTaskStatus,
		clock: ClockReading,
		statusMessage: string | undefined,
	): void {
		stored.task = {
			...stored.task,
			status,
			lastUpdatedAt: clock.iso,
			...(statusMessage !== undefined
				? { statusMessage }
				: stored.task.statusMessage !== undefined
					? { statusMessage: stored.task.statusMessage }
					: {}),
		};
	}

	#requireTask(taskId: string): StoredTask {
		const task = this.#tasks.get(taskId);
		if (!task) throw new Error(`MCP task "${taskId}" not found`);
		return task;
	}

	#nextTaskId(): string {
		for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
			const id = this.#generateTaskId();
			if (typeof id !== "string" || id.length === 0) {
				throw new Error("Generated MCP task id must be a non-empty string");
			}
			if (!this.#tasks.has(id)) return id;
		}
		throw new Error("Unable to generate a unique MCP task id");
	}

	#readClock(): ClockReading {
		const date = this.#now();
		const ms = date.getTime();
		if (!Number.isFinite(ms)) throw new Error("MCP task store clock returned an invalid Date");
		return { ms, iso: date.toISOString() };
	}
}

function taskSettlement(stored: StoredTask): McpTaskResultSettlement | null {
	if (stored.terminal) {
		return {
			kind: "terminal",
			task: cloneTask(stored.task),
			terminal: cloneTerminalResult(stored.terminal),
		};
	}
	if (stored.inputRequired) {
		return {
			kind: "input_required",
			task: cloneTask(stored.task),
			inputRequired: cloneInputRequired(stored.inputRequired),
		};
	}
	return null;
}

function requirePositiveInteger(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`MCP task ${field} must be a positive integer`);
	}
	return value;
}

function assertInputRequiredResult(result: McpInputRequiredResult): void {
	if (result.resultType !== "input_required") {
		throw new Error("MCP task input-required result must have resultType \"input_required\"");
	}
	if (result.inputRequests === undefined && result.requestState === undefined) {
		throw new Error("MCP task input-required result must include inputRequests or requestState");
	}
}

function assertJsonRpcErrorObject(error: JsonRpcErrorObject): void {
	if (typeof error.code !== "number" || typeof error.message !== "string") {
		throw new Error("MCP task JSON-RPC error must include numeric code and string message");
	}
}

function assertTerminalResult(result: McpStoredTaskTerminalResult): void {
	if (result.kind === "error") {
		assertJsonRpcErrorObject(result.error);
		return;
	}
	if (result.kind !== "result") {
		throw new Error("MCP task terminal result must be a stored result or error");
	}
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ version: 1, offset }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): number {
	try {
		const decoded = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf-8"),
		) as KotaJsonValue;
		if (!isCursorPayload(decoded)) {
			throw new Error("malformed cursor");
		}
		return decoded.offset;
	} catch (err) {
		if (err instanceof Error && err.message === "malformed cursor") {
			throw new Error("Invalid MCP task cursor");
		}
		throw new Error("Invalid MCP task cursor");
	}
}

function isCursorPayload(value: KotaJsonValue): value is { version: 1; offset: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		value.version === 1 &&
		typeof value.offset === "number" &&
		Number.isSafeInteger(value.offset) &&
		value.offset >= 0
	);
}

function cloneTask(task: McpTask): McpTask {
	return { ...task };
}

function cloneInputRequired(result: McpInputRequiredResult): McpInputRequiredResult {
	return structuredClone(result);
}

function cloneTerminalResult(result: McpStoredTaskTerminalResult): McpStoredTaskTerminalResult {
	return structuredClone(result);
}

function cloneSettlement(settlement: McpTaskResultSettlement): McpTaskResultSettlement {
	return structuredClone(settlement);
}

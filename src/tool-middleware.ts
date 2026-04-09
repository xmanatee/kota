/**
 * Tool Middleware — composable pre/post hooks for tool execution.
 *
 * Modules register middleware via ctx.registerMiddleware(). Each middleware
 * wraps tool execution: it can inspect/modify input, short-circuit, transform
 * results, or add side effects. Middleware runs in priority order (lower first).
 *
 * Example middleware:
 *   (call, next) => {
 *     if (call.name === "shell") log("shell called");
 *     const result = await next();
 *     return { ...result, content: result.content + "\n[cached]" };
 *   }
 */

import type { ToolResult } from "./tools/index.js";

export type ToolCall = {
	name: string;
	input: Record<string, unknown>;
};

export type ToolMiddlewareFn = (
	call: ToolCall,
	next: () => Promise<ToolResult>,
) => Promise<ToolResult>;

type MiddlewareEntry = {
	name: string;
	fn: ToolMiddlewareFn;
	priority: number;
	owner?: string;
};

export class ToolMiddlewareRegistry {
	private entries: MiddlewareEntry[] = [];

	/** Register middleware. Lower priority runs first (outermost). Default priority: 100. */
	add(
		name: string,
		fn: ToolMiddlewareFn,
		opts?: { priority?: number; owner?: string },
	): void {
		if (this.entries.some((e) => e.name === name)) {
			throw new Error(`Middleware already registered: ${name}`);
		}
		const entry: MiddlewareEntry = {
			name,
			fn,
			priority: opts?.priority ?? 100,
			owner: opts?.owner,
		};
		this.entries.push(entry);
		this.entries.sort((a, b) => a.priority - b.priority);
	}

	/** Remove middleware by name. Returns true if found. */
	remove(name: string): boolean {
		const idx = this.entries.findIndex((e) => e.name === name);
		if (idx < 0) return false;
		this.entries.splice(idx, 1);
		return true;
	}

	/** Remove all middleware registered by a specific owner (module). */
	removeByOwner(owner: string): number {
		const before = this.entries.length;
		this.entries = this.entries.filter((e) => e.owner !== owner);
		return before - this.entries.length;
	}

	/** Execute the middleware chain, calling baseFn at the innermost level. */
	async execute(
		call: ToolCall,
		baseFn: () => Promise<ToolResult>,
	): Promise<ToolResult> {
		if (this.entries.length === 0) return baseFn();

		let idx = 0;
		const chain = async (): Promise<ToolResult> => {
			if (idx >= this.entries.length) return baseFn();
			const entry = this.entries[idx++];
			return entry.fn(call, chain);
		};
		return chain();
	}

	/** Number of registered middleware. */
	get size(): number {
		return this.entries.length;
	}

	/** List registered middleware names in execution order. */
	list(): string[] {
		return this.entries.map((e) => e.name);
	}

	/** Clear all middleware. */
	clear(): void {
		this.entries = [];
	}
}

// ─── Singleton ───────────────────────────────────────────────────────

let _registry: ToolMiddlewareRegistry | null = null;

export function getToolMiddleware(): ToolMiddlewareRegistry {
	if (!_registry) _registry = new ToolMiddlewareRegistry();
	return _registry;
}

export function resetToolMiddleware(): void {
	_registry?.clear();
	_registry = null;
}

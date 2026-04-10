import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "../modules/module-loader.js";
import {
	getToolMiddleware,
	resetToolMiddleware,
	type ToolCall,
	ToolMiddlewareRegistry,
} from "./tool-middleware.js";
import { clearCustomTools, type ToolResult } from "./index.js";

const ok = (content: string): ToolResult => ({ content });
const base = () => Promise.resolve(ok("base"));

describe("ToolMiddlewareRegistry", () => {
	it("passes through to base when no middleware registered", async () => {
		const reg = new ToolMiddlewareRegistry();
		const result = await reg.execute({ name: "shell", input: {} }, base);
		expect(result.content).toBe("base");
	});

	it("single middleware wraps execution", async () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("logger", async (_call, next) => {
			const result = await next();
			return { ...result, content: `[logged] ${result.content}` };
		});
		const result = await reg.execute({ name: "shell", input: {} }, base);
		expect(result.content).toBe("[logged] base");
	});

	it("multiple middleware execute in priority order (lower first)", async () => {
		const reg = new ToolMiddlewareRegistry();
		const order: string[] = [];

		reg.add(
			"second",
			async (_call, next) => {
				order.push("second-before");
				const r = await next();
				order.push("second-after");
				return r;
			},
			{ priority: 200 },
		);
		reg.add(
			"first",
			async (_call, next) => {
				order.push("first-before");
				const r = await next();
				order.push("first-after");
				return r;
			},
			{ priority: 100 },
		);

		await reg.execute({ name: "test", input: {} }, base);
		expect(order).toEqual([
			"first-before",
			"second-before",
			"second-after",
			"first-after",
		]);
	});

	it("middleware can short-circuit without calling next", async () => {
		const reg = new ToolMiddlewareRegistry();
		let baseCalled = false;

		reg.add("blocker", async () => ok("blocked"));

		const result = await reg.execute({ name: "shell", input: {} }, () => {
			baseCalled = true;
			return base();
		});
		expect(result.content).toBe("blocked");
		expect(baseCalled).toBe(false);
	});

	it("middleware receives the tool call context", async () => {
		const reg = new ToolMiddlewareRegistry();
		let captured: ToolCall | null = null;

		reg.add("capture", async (call, next) => {
			captured = call;
			return next();
		});

		await reg.execute({ name: "grep", input: { pattern: "foo" } }, base);
		expect(captured).toEqual({ name: "grep", input: { pattern: "foo" } });
	});

	it("middleware can transform input before passing to next", async () => {
		const reg = new ToolMiddlewareRegistry();

		reg.add("transformer", async (call, next) => {
			call.input.extra = true;
			return next();
		});

		let receivedInput: Record<string, unknown> = {};
		await reg.execute({ name: "test", input: { a: 1 } }, () => {
			// The base won't see the mutation directly, but the call object is shared
			return Promise.resolve(ok("done"));
		});

		// Verify through a second middleware that observes the mutation
		const reg2 = new ToolMiddlewareRegistry();
		reg2.add(
			"mutator",
			async (call, next) => {
				call.input.injected = true;
				return next();
			},
			{ priority: 10 },
		);
		reg2.add(
			"observer",
			async (call, next) => {
				receivedInput = { ...call.input };
				return next();
			},
			{ priority: 20 },
		);
		await reg2.execute({ name: "test", input: { a: 1 } }, base);
		expect(receivedInput).toEqual({ a: 1, injected: true });
	});

	it("throws on duplicate middleware name", () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("unique", async (_c, next) => next());
		expect(() => reg.add("unique", async (_c, next) => next())).toThrow(
			"Middleware already registered: unique",
		);
	});

	it("remove returns true for existing, false for missing", () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("temp", async (_c, next) => next());
		expect(reg.remove("temp")).toBe(true);
		expect(reg.remove("temp")).toBe(false);
	});

	it("removed middleware no longer runs", async () => {
		const reg = new ToolMiddlewareRegistry();
		let ran = false;
		reg.add("ephemeral", async (_c, next) => {
			ran = true;
			return next();
		});
		reg.remove("ephemeral");
		await reg.execute({ name: "test", input: {} }, base);
		expect(ran).toBe(false);
	});

	it("removeByOwner removes all middleware for a module", () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("a", async (_c, next) => next(), { owner: "mod1" });
		reg.add("b", async (_c, next) => next(), { owner: "mod1" });
		reg.add("c", async (_c, next) => next(), { owner: "mod2" });
		expect(reg.removeByOwner("mod1")).toBe(2);
		expect(reg.size).toBe(1);
		expect(reg.list()).toEqual(["c"]);
	});

	it("removeByOwner returns 0 for unknown owner", () => {
		const reg = new ToolMiddlewareRegistry();
		expect(reg.removeByOwner("nobody")).toBe(0);
	});

	it("list returns names in priority order", () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("z", async (_c, next) => next(), { priority: 300 });
		reg.add("a", async (_c, next) => next(), { priority: 100 });
		reg.add("m", async (_c, next) => next(), { priority: 200 });
		expect(reg.list()).toEqual(["a", "m", "z"]);
	});

	it("clear removes all middleware", () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("a", async (_c, next) => next());
		reg.add("b", async (_c, next) => next());
		reg.clear();
		expect(reg.size).toBe(0);
	});

	it("middleware error propagates to caller", async () => {
		const reg = new ToolMiddlewareRegistry();
		reg.add("boom", async () => {
			throw new Error("middleware failed");
		});
		await expect(
			reg.execute({ name: "test", input: {} }, base),
		).rejects.toThrow("middleware failed");
	});

	it("default priority is 100", async () => {
		const reg = new ToolMiddlewareRegistry();
		const order: string[] = [];

		reg.add("default", async (_c, next) => {
			order.push("default");
			return next();
		});
		reg.add("early", async (_c, next) => {
			order.push("early");
			return next();
		}, { priority: 50 });
		reg.add("late", async (_c, next) => {
			order.push("late");
			return next();
		}, { priority: 150 });

		await reg.execute({ name: "test", input: {} }, base);
		expect(order).toEqual(["early", "default", "late"]);
	});
});

describe("singleton", () => {
	afterEach(() => resetToolMiddleware());

	it("getToolMiddleware returns same instance", () => {
		const a = getToolMiddleware();
		const b = getToolMiddleware();
		expect(a).toBe(b);
	});

	it("resetToolMiddleware creates fresh instance", () => {
		const a = getToolMiddleware();
		a.add("test", async (_c, next) => next());
		resetToolMiddleware();
		const b = getToolMiddleware();
		expect(b.size).toBe(0);
	});
});

describe("ModuleLoader middleware integration", () => {
	beforeEach(() => {
		clearCustomTools();
		resetToolMiddleware();
	});

	afterEach(() => {
		clearCustomTools();
		resetToolMiddleware();
	});

	it("module registers middleware via ctx.registerMiddleware", async () => {
		const loader = new ModuleLoader({});
		await loader.load({
			name: "audit",
			onLoad: (ctx) => {
				ctx.registerMiddleware("audit-log", async (_call, next) => {
					const result = await next();
					return { ...result, content: `[audited] ${result.content}` };
				});
			},
		});
		const mw = getToolMiddleware();
		expect(mw.size).toBe(1);
		expect(mw.list()).toEqual(["audit-log"]);
	});

	it("module middleware is cleaned up on unload", async () => {
		const loader = new ModuleLoader({});
		await loader.load({
			name: "temp-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("temp-mw", async (_c, next) => next());
			},
		});
		expect(getToolMiddleware().size).toBe(1);
		await loader.unload("temp-mod");
		expect(getToolMiddleware().size).toBe(0);
	});

	it("unloadAll clears all module middleware", async () => {
		const loader = new ModuleLoader({});
		await loader.load({
			name: "mod-a",
			onLoad: (ctx) => {
				ctx.registerMiddleware("mw-a", async (_c, next) => next());
			},
		});
		await loader.load({
			name: "mod-b",
			onLoad: (ctx) => {
				ctx.registerMiddleware("mw-b", async (_c, next) => next());
			},
		});
		expect(getToolMiddleware().size).toBe(2);
		await loader.unloadAll();
		expect(getToolMiddleware().size).toBe(0);
	});

	it("module middleware with priority controls execution order", async () => {
		const loader = new ModuleLoader({});
		const order: string[] = [];

		await loader.load({
			name: "late-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("late", async (_c, next) => {
					order.push("late");
					return next();
				}, 200);
			},
		});
		await loader.load({
			name: "early-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("early", async (_c, next) => {
					order.push("early");
					return next();
				}, 50);
			},
		});

		const mw = getToolMiddleware();
		await mw.execute({ name: "test", input: {} }, base);
		expect(order).toEqual(["early", "late"]);
	});
});

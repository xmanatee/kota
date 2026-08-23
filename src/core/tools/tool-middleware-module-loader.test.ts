import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { clearCustomTools, type ToolResult } from "./index.js";
import { getToolMiddleware, resetToolMiddleware } from "./tool-middleware.js";

const base = (): Promise<ToolResult> => Promise.resolve({ content: "base" });

describe("ModuleLoader middleware integration", () => {
	beforeEach(() => {
		clearCustomTools();
		resetToolMiddleware();
	});

	afterEach(() => {
		clearCustomTools();
		resetToolMiddleware();
	});

	function runtimeLoader(): ModuleLoader {
		const loader = new ModuleLoader({});
		loader.setBus(new EventBus());
		return loader;
	}

	it("module registers middleware via ctx.registerMiddleware", async () => {
		const loader = runtimeLoader();
		await loader.load({
			name: "audit",
			onLoad: (ctx) => {
				ctx.registerMiddleware("audit-log", async (_call, next) => {
					const result = await next();
					return { ...result, content: `[audited] ${result.content}` };
				});
			},
		});
		const middleware = getToolMiddleware();
		expect(middleware.size).toBe(1);
		expect(middleware.list()).toEqual(["audit-log"]);
	});

	it("module middleware is cleaned up on unload", async () => {
		const loader = runtimeLoader();
		await loader.load({
			name: "temp-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("temp-mw", async (_call, next) => next());
			},
		});
		expect(getToolMiddleware().size).toBe(1);
		await loader.unload("temp-mod");
		expect(getToolMiddleware().size).toBe(0);
	});

	it("unloadAll clears all module middleware", async () => {
		const loader = runtimeLoader();
		await loader.load({
			name: "mod-a",
			onLoad: (ctx) => {
				ctx.registerMiddleware("mw-a", async (_call, next) => next());
			},
		});
		await loader.load({
			name: "mod-b",
			onLoad: (ctx) => {
				ctx.registerMiddleware("mw-b", async (_call, next) => next());
			},
		});
		expect(getToolMiddleware().size).toBe(2);
		await loader.unloadAll();
		expect(getToolMiddleware().size).toBe(0);
	});

	it("module middleware with priority controls execution order", async () => {
		const loader = runtimeLoader();
		const order: string[] = [];

		await loader.load({
			name: "late-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("late", async (_call, next) => {
					order.push("late");
					return next();
				}, 200);
			},
		});
		await loader.load({
			name: "early-mod",
			onLoad: (ctx) => {
				ctx.registerMiddleware("early", async (_call, next) => {
					order.push("early");
					return next();
				}, 50);
			},
		});

		await getToolMiddleware().execute({ name: "test", input: {} }, base);
		expect(order).toEqual(["early", "late"]);
	});
});

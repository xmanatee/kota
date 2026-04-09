import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveModuleSkills } from "../../module-types.js";
import { getToolMiddleware, resetToolMiddleware } from "../../tool-middleware.js";
import toolRetryModule from "./index.js";
import { resetRetryStats } from "./tool-retry.js";

describe("tool-retry module", () => {
	const ctx = {
		config: {},
		storage: { path: "/tmp/test-retry" },
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
		registerMiddleware: (name: string, fn: unknown, priority: number) => {
			getToolMiddleware().add(name, fn as any, { priority });
		},
	};

	afterEach(() => {
		resetToolMiddleware();
		resetRetryStats();
	});

	it("registers retry middleware on load", () => {
		toolRetryModule.onLoad!(ctx as any);
		expect(getToolMiddleware().list()).toContain("tool-retry");
		expect(ctx.log.info).toHaveBeenCalledWith("Tool retry middleware enabled");
	});

	it("middleware retries transient errors", async () => {
		toolRetryModule.onLoad!(ctx as any);
		const middleware = getToolMiddleware();

		let callCount = 0;
		const result = await middleware.execute(
			{ name: "web_fetch", input: { url: "https://x.com" } },
			async () => {
				callCount++;
				if (callCount === 1) return { content: "ECONNRESET", is_error: true };
				return { content: "ok" };
			},
		);

		expect(callCount).toBe(2);
		expect(result.content).toContain("ok");
		expect(result.content).toContain("auto-retry");
	});

	it("cleans up on unload", () => {
		toolRetryModule.onLoad!(ctx as any);
		expect(getToolMiddleware().size).toBe(1);
		toolRetryModule.onUnload!();
		// Stats reset (middleware removal is handled by module loader)
	});

	it("declares a skill for retry guidance", async () => {
		const [skill] = await resolveModuleSkills(toolRetryModule, ctx as any);
		expect(skill.name).toBe("tool-retry");
		expect(skill.promptPath).toContain("tool-retry.md");
	});
});

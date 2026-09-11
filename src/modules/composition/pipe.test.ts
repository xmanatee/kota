import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool, type ToolRunner, type ToolRunnerContext } from "#core/tools/index.js";
import { withToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
import { runPipe as executePipe } from "./pipe.js";

const mockState = { calls: [] as Array<{ name: string; input: Record<string, unknown>; context: unknown }> };
const runners: Record<string, ToolRunner> = {
 echo: async input => ({ content: String(input.text ?? "") }),
 upper: async input => ({ content: String(input.text ?? "").toUpperCase() }),
 concat: async input => ({ content: `${input.a ?? ""}|${input.b ?? ""}` }),
 fail_tool: async () => ({ content: "something went wrong", is_error: true }),
 throw_tool: async () => { throw new Error("boom"); },
 json_out: async () => ({ content: JSON.stringify({ name: "alice", score: 42 }) }),
};
beforeEach(() => {
 for (const [name, runner] of Object.entries(runners)) registerTool({ name, description: name, input_schema: { type: "object", properties: {}, additionalProperties: true } }, async (input, context) => {
   mockState.calls.push({name, input, context});
   return runner(input, context);
 }, undefined, { effect: readOnlyLocalEffect() });
});
afterEach(() => { for (const name of Object.keys(runners)) deregisterTool(name); mockState.calls.length = 0; });
function runPipe(input: Record<string, unknown>, context?: ToolRunnerContext) {
 return withToolCallExecutionOptions({ resultLimit: 50_000, verbose: false, autonomyMode: "autonomous", ...context }, () => executePipe(input));
}

describe("pipe tool", () => {
	describe("validation", () => {
		it("rejects empty steps", async () => {
			const r = await runPipe({ steps: [] });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("must not be empty");
		});

		it("rejects non-array steps", async () => {
			const r = await runPipe({ steps: "not-array" });
			expect(r.is_error).toBe(true);
		});

		it("rejects too many steps", async () => {
			const steps = Array.from({ length: 11 }, (_, i) => ({ tool: `t${i}` }));
			const r = await runPipe({ steps });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("max 10");
		});

		it("rejects step without tool name", async () => {
			const r = await runPipe({ steps: [{ input: { text: "hi" } }] });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("missing tool name");
		});
	});

	describe("basic execution", () => {
		it("executes a single step", async () => {
			const r = await runPipe({ steps: [{ tool: "echo", input: { text: "hello" } }] });
			expect(r.is_error).toBeUndefined();
			expect(r.content).toBe("hello");
		});

		it("chains two steps with $prev", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "hello world" } },
					{ tool: "upper", input: { text: "$prev" } },
				],
			});
			expect(r.content).toBe("HELLO WORLD");
		});

		it("passes runner context to each nested tool", async () => {
			const context = {
				cwd: "/tmp/scope-b",
				scopeId: "scope-b",
				sessionId: "session-b",
			};

			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "hello" } },
					{ tool: "upper", input: { text: "$prev" } },
				],
			}, context);

			expect(r.content).toBe("HELLO");
			expect(mockState.calls).toHaveLength(2);
			expect(mockState.calls.map((call) => call.context)).toEqual([expect.objectContaining(context), expect.objectContaining(context)]);
		});

		it("chains three steps", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "one" } },
					{ tool: "echo", input: { text: "two" } },
					{ tool: "concat", input: { a: "$steps[0]", b: "$prev" } },
				],
			});
			expect(r.content).toBe("one|two");
		});
	});

	describe("data flow", () => {
		it("supports $steps[N] references", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "alpha" } },
					{ tool: "echo", input: { text: "beta" } },
					{ tool: "concat", input: { a: "$steps[0]", b: "$steps[1]" } },
				],
			});
			expect(r.content).toBe("alpha|beta");
		});

		it("supports $prev.field for JSON outputs", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "json_out" },
					{ tool: "echo", input: { text: "$prev.name" } },
				],
			});
			expect(r.content).toBe("alice");
		});

		it("supports {{template}} interpolation", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "json_out" },
					{ tool: "echo", input: { text: "Name: {{$prev.name}}, Score: {{$prev.score}}" } },
				],
			});
			expect(r.content).toBe("Name: alice, Score: 42");
		});
	});

	describe("conditional steps", () => {
		it("skips step when condition is false", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "" } },
					{ tool: "upper", input: { text: "skipped" }, if: "$prev" },
					{ tool: "echo", input: { text: "final" } },
				],
			});
			expect(r.content).toBe("final");
		});

		it("runs step when condition is true", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "truthy" } },
					{ tool: "upper", input: { text: "$prev" }, if: "$prev" },
				],
			});
			expect(r.content).toBe("TRUTHY");
		});
	});

	describe("error handling", () => {
		it("stops on tool error and reports step", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "ok" } },
					{ tool: "fail_tool" },
					{ tool: "echo", input: { text: "never" } },
				],
			});
			expect(r.is_error).toBe(true);
			expect(r.content).toContain('Step 2/3 ("fail_tool") failed');
		});

		it("catches thrown errors", async () => {
			const r = await runPipe({
				steps: [{ tool: "throw_tool" }],
			});
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("failed");
			expect(r.content).toContain("boom");
		});

		it("reports unknown tool as error", async () => {
			const r = await runPipe({
				steps: [{ tool: "nonexistent_xyz" }],
			});
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("failed");
		});
	});

	describe("edge cases", () => {
		it("handles step with no input", async () => {
			const r = await runPipe({ steps: [{ tool: "json_out" }] });
			expect(r.content).toContain("alice");
		});

		it("returns last step output as final result", async () => {
			const r = await runPipe({
				steps: [
					{ tool: "echo", input: { text: "first" } },
					{ tool: "echo", input: { text: "second" } },
					{ tool: "echo", input: { text: "third" } },
				],
			});
			expect(r.content).toBe("third");
		});
	});
});

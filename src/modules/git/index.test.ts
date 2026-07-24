import { afterEach, describe, expect, it } from "vitest";
import { resolveModuleTools } from "#core/modules/module-types.js";
import {
	classifyRisk,
	getToolMcpAnnotations,
} from "#core/tools/guardrails-classify.js";
import {
	clearCustomTools,
	getToolEffect,
	registerTool,
} from "#core/tools/index.js";
import gitModule from "./index.js";

function registerGitTool(): void {
	const [definition] = resolveModuleTools(gitModule);
	if (!definition?.resolveEffect) {
		throw new Error("Git tool must declare invocation-specific effects");
	}
	registerTool(definition.tool, definition.runner, gitModule.name, {
		effect: definition.effect,
		resolveEffect: definition.resolveEffect,
	});
}

describe("git tool effects", () => {
	afterEach(() => clearCustomTools());

	it("advertises its external-network mutation capability", () => {
		registerGitTool();

		expect(getToolEffect("git")).toMatchObject({
			kind: "write",
			scope: "external-network",
			openWorld: true,
		});
		expect(getToolMcpAnnotations("git")).toMatchObject({
			destructiveHint: false,
			openWorldHint: true,
		});
	});

	it("resolves external writes and escalates forced pushes per invocation", () => {
		registerGitTool();

		expect(getToolEffect("git", { op: "status" })).toBeUndefined();
		expect(getToolEffect("git", {
			op: "push",
			args: "origin HEAD:feature",
		})).toMatchObject({
			kind: "write",
			scope: "external-network",
		});
		expect(getToolEffect("git", {
			op: "push",
			args: "origin +HEAD:feature",
		})).toMatchObject({
			kind: "destructive",
			scope: "external-network",
		});
	});

	it("classifies force flags, force refspecs, and force-with-lease as dangerous", () => {
		registerGitTool();

		for (const args of [
			"--force origin HEAD:feature",
			"origin +HEAD:feature",
			"--force-with-lease origin HEAD:feature",
		]) {
			expect(classifyRisk("git", { op: "push", args }).risk).toBe("dangerous");
		}
		expect(classifyRisk("git", {
			op: "push",
			args: "origin HEAD:feature",
		}).risk).toBe("moderate");
		expect(classifyRisk("git", {
			op: "push",
			args: "origin",
		}).risk).toBe("dangerous");
	});
});

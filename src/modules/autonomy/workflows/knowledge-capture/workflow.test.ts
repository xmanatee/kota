import { describe, expect, it } from "vitest";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import knowledgeCaptureWorkflow from "./workflow.js";

describe("knowledge-capture workflow definition", () => {
	it("registers without errors", () => {
		const registered = registerWorkflowDefinition(
			"src/modules/autonomy/workflows/knowledge-capture/workflow.ts",
			knowledgeCaptureWorkflow,
		);
		expect(registered.name).toBe("knowledge-capture");
	});

	it("triggers only on builder and improver success", () => {
		const registered = registerWorkflowDefinition(
			"src/modules/autonomy/workflows/knowledge-capture/workflow.ts",
			knowledgeCaptureWorkflow,
		);
		expect(registered.triggers).toHaveLength(1);
		expect(registered.triggers[0].event).toBe("workflow.completed");
		expect(registered.triggers[0].filter).toEqual({
			workflow: ["builder", "improver"],
			status: "success",
		});
	});

	it("has a single code step named capture", () => {
		const registered = registerWorkflowDefinition(
			"src/modules/autonomy/workflows/knowledge-capture/workflow.ts",
			knowledgeCaptureWorkflow,
		);
		expect(registered.steps).toHaveLength(1);
		expect(registered.steps[0].id).toBe("capture");
		expect(registered.steps[0].type).toBe("code");
	});

	it("cannot self-trigger (name is not builder or improver)", () => {
		expect(knowledgeCaptureWorkflow.name).toBe("knowledge-capture");
		// The trigger filter only matches "builder" and "improver", so
		// knowledge-capture's own completion will never match.
	});
});

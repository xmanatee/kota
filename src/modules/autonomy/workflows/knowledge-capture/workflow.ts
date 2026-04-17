import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { captureRunInsight } from "./capture.js";

// Not recovery-capable: writes only to the knowledge store under .kota/,
// never to tracked files. Recovery dispatch is driven by tracked-dirty
// state, so knowledge-capture cannot contribute to or consume it.
const knowledgeCaptureWorkflow: WorkflowDefinitionInput = {
	name: "knowledge-capture",
	description:
		"Extract structured insights from completed builder/improver runs into the knowledge store.",
	triggers: [
		{
			event: "workflow.completed",
			filter: {
				workflow: ["builder", "improver"],
				status: "success",
			},
		},
	],
	steps: [
		{
			id: "capture",
			type: "code",
			run: ({ projectDir, trigger }) => {
				const { runId, workflow, runDir } = trigger.payload as {
					runId: string;
					workflow: string;
					runDir: string;
				};
				return captureRunInsight(projectDir, runDir, runId, workflow);
			},
		},
	],
};

export default knowledgeCaptureWorkflow;

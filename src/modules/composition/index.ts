import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { batchTool, runBatch } from "./batch.js";
import { mapTool, runMap } from "./map.js";
import { pipeTool, runPipe } from "./pipe.js";

const tools: ToolDef[] = [
	{
		tool: batchTool,
		runner: runBatch,
		risk: "moderate",
		kind: "action",
		group: "orchestration",
	},
	{
		tool: pipeTool,
		runner: runPipe,
		risk: "moderate",
		kind: "action",
		group: "orchestration",
	},
	{
		tool: mapTool,
		runner: runMap,
		risk: "moderate",
		kind: "action",
		group: "orchestration",
	},
];

const compositionModule: KotaModule = {
	name: "composition",
	version: "1.0.0",
	description: "Orchestration tools: batch, pipe, map",
	tools,
};

export default compositionModule;

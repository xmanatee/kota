import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { localWriteEffect, sessionWriteEffect } from "#core/tools/effect.js";
import { batchTool, runBatch } from "./batch.js";
import { mapTool, runMap } from "./map.js";
import { pipeTool, runPipe } from "./pipe.js";
import { runWorkspace, workspaceTool } from "./workspace.js";

const tools: ToolDef[] = [
	{
		tool: batchTool,
		runner: runBatch,
		effect: localWriteEffect(),
		group: "orchestration",
	},
	{
		tool: pipeTool,
		runner: runPipe,
		effect: localWriteEffect(),
		group: "orchestration",
	},
	{
		tool: mapTool,
		runner: runMap,
		effect: localWriteEffect(),
		group: "orchestration",
	},
	{
		tool: workspaceTool,
		runner: runWorkspace,
		effect: sessionWriteEffect(),
		group: "orchestration",
	},
];

const compositionModule: KotaModule = {
	name: "composition",
	version: "1.0.0",
	description: "Orchestration tools: batch, pipe, map, workspace",
	tools,
};

export default compositionModule;

/**
 * Notebook module — Jupyter notebook creation and editing.
 *
 * Tools:
 *   notebook — create or extend .ipynb notebooks with code and markdown cells
 */


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { notebookTool, runNotebook } from "./notebook.js";

const tools: ToolDef[] = [
  {
    tool: notebookTool,
    runner: runNotebook,
    effect: localWriteEffect(),
    group: "code",
  },
];

const notebookModule: KotaModule = {
  name: "notebook",
  version: "1.0.0",
  description: "Jupyter notebook creation and cell editing",
  tools,
};

export default notebookModule;

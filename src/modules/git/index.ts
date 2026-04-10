/**
 * Git module — version control operations with safety guardrails.
 *
 * Tools:
 *   git — status, diff, log, show, add, commit, branch, push
 *
 * Force-push to main/master is blocked. Large diffs are auto-truncated.
 * Deletion of protected branches (main, master) is blocked.
 */

import type { KotaModule, ToolDef } from "../../core/modules/module-types.js";
import { gitTool, runGit } from "./git.js";

const tools: ToolDef[] = [
  {
    tool: gitTool,
    runner: runGit,
    risk: "moderate",
    kind: "action",
  },
];

const gitModule: KotaModule = {
  name: "git",
  version: "1.0.0",
  description: "Git version control tool with safety guardrails",
  tools,
};

export default gitModule;

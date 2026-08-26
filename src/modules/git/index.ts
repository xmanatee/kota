/**
 * Git module — version control operations with safety guardrails.
 *
 * Tools:
 *   git — status, diff, log, show, add, commit, branch, push
 *
 * Force-push to main/master is blocked. Large diffs are auto-truncated.
 * Deletion of protected branches (main, master) is blocked.
 */


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import { gitTool, runGit } from "./git.js";
import { resolveGitToolEffect } from "./push-safety.js";

const tools: ToolDef[] = [
  {
    tool: gitTool,
    runner: runGit,
    effect: networkWriteEffect(),
    resolveEffect: resolveGitToolEffect,
  },
];

const gitModule: KotaModule = {
  name: "git",
  version: "1.0.0",
  description: "Git version control tool with safety guardrails",
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "git.repository",
        description:
          "Inspect and mutate local Git state and push operator-authorized updates to configured remotes.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "owner-confirmation", "writes"],
      },
    ],
    dataClasses: [
      {
        id: "git.repository-state",
        description:
          "Local repository metadata, diffs, commit history, branches, and remote update results.",
        sensitivity: "internal",
        retention: "scope-durable",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Git pushes mutate configured remotes and are blocked in workflow trial mode.",
      ],
    },
  },
  tools,
};

export default gitModule;

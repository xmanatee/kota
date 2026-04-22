/**
 * harness-parity module — operator-facing CLI for capturing paired coding-task
 * artifacts across every registered `AgentHarness`. The module owns the
 * scenario schema, the runner, and the CLI; live capture happens through
 * `runAgentHarness`, so there is no second benchmarking framework.
 */

import { join, resolve } from "node:path";
import type { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { buildHarnessParityCommand } from "./cli.js";

const harnessParityModule: KotaModule = {
  name: "harness-parity",
  version: "1.0.0",
  description:
    "Runs coding-task scenarios across every registered agent harness and captures paired artifacts.",
  dependencies: ["rendering"],
  commands: (ctx: ModuleContext): Command[] => {
    const projectDir = ctx.cwd;
    const moduleDir = resolve(
      projectDir,
      "src/modules/harness-parity",
    );
    return [
      buildHarnessParityCommand({
        projectDir,
        scenariosRoot: join(moduleDir, "scenarios"),
        defaultOutBaseDir: join(projectDir, ".kota/runs"),
      }),
    ];
  },
};

export default harnessParityModule;

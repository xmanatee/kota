/**
 * harness-parity module — operator-facing CLI for capturing paired coding-task
 * artifacts across every registered `AgentHarness`. The module owns the
 * scenario schema, the runner, and the CLI; live capture happens through
 * `runAgentHarness`, so there is no second benchmarking framework.
 */

import { join, resolve } from "node:path";
import type { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { HarnessParityClient } from "#core/server/kota-client.js";
import { buildHarnessParityCommand } from "./cli.js";
import {
  type HarnessParityDeps,
  listHarnessParityScenarios,
  runHarnessParity,
} from "./harness-parity-operations.js";
import { harnessParityControlRoutes } from "./routes.js";

function resolveDeps(ctx: ModuleContext): HarnessParityDeps {
  const moduleDir = resolve(ctx.cwd, "src/modules/harness-parity");
  return {
    scenariosRoot: join(moduleDir, "scenarios"),
    defaultOutBaseDir: join(ctx.cwd, ".kota/runs"),
  };
}

const harnessParityModule: KotaModule = {
  name: "harness-parity",
  version: "1.0.0",
  description:
    "Runs coding-task scenarios across every registered agent harness and captures paired artifacts.",
  dependencies: ["rendering"],
  commands: (ctx: ModuleContext): Command[] => [
    buildHarnessParityCommand({ ctx }),
  ],
  controlRoutes: (ctx) => harnessParityControlRoutes(resolveDeps(ctx)),
  localClient: (ctx) => {
    const deps = resolveDeps(ctx);
    const harnessParity: HarnessParityClient = {
      async list() {
        return listHarnessParityScenarios(deps);
      },
      async run(options) {
        return runHarnessParity(deps, options);
      },
    };
    return { harnessParity };
  },
};

export default harnessParityModule;

/**
 * harness-parity module — operator-facing CLI for capturing paired coding-task
 * artifacts across every registered `AgentHarness`. The module owns the
 * scenario schema, the runner, and the CLI; live capture happens through
 * `runAgentHarness`, so there is no second benchmarking framework.
 *
 * The harness-parity namespace is fully module-owned: types live in
 * `./client.ts`, the daemon HTTP routes live in `./routes.ts`,
 * `localClient(ctx)` exposes the in-process handler, and `daemonClient(link)`
 * exposes the daemon-up handler that calls the same routes through the typed
 * `DaemonTransport`.
 */

import { join, resolve } from "node:path";
import type { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { buildHarnessParityCommand } from "./cli.js";
import type {
  HarnessParityClient,
  HarnessParityListResult,
  HarnessParityRunOptions,
  HarnessParityRunResult,
} from "./client.js";
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

/**
 * Daemon-side `HarnessParityClient` backed by the typed `DaemonTransport`.
 * Calls the same `/harness-parity/scenarios` and `/harness-parity/run` HTTP
 * routes the daemon registers through `harnessParityControlRoutes(deps)`. The
 * transport surface owns the bearer token, base URL, and timeout policy —
 * this factory only encodes the wire shape.
 *
 * `run` preserves the typed 400-response branch by issuing the request
 * through `link.fetchRaw` so the `{ ok: false; reason; message }` discriminator
 * round-trips unchanged. The strict request helper would throw on 400 and
 * collapse the typed failure into a plain `Error`.
 */
function buildHarnessParityDaemonHandler(
  link: DaemonTransport,
): HarnessParityClient {
  return {
    list: async (): Promise<HarnessParityListResult> =>
      link.requestStrict<HarnessParityListResult>(
        "GET",
        "/harness-parity/scenarios",
      ),
    run: async (
      options?: HarnessParityRunOptions,
    ): Promise<HarnessParityRunResult> => {
      const res = await link.fetchRaw("/harness-parity/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });
      if (res.status === 400) {
        return (await res.json()) as HarnessParityRunResult;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as HarnessParityRunResult;
    },
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
  daemonClient: (link) => ({
    harnessParity: buildHarnessParityDaemonHandler(link),
  }),
};

export default harnessParityModule;

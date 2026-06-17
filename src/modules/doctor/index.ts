/**
 * Doctor module — owns the `kota doctor` CLI health check surface.
 *
 * Registers the `kota doctor` command that runs pass/warn/fail checks
 * against daemon connectivity, config validity, modules, providers,
 * workflow definitions, and disk state. The CLI handler routes through
 * `ctx.client.doctor.{run,fix}()` so daemon-up and daemon-down operators
 * see the same diagnostics for the same project state.
 *
 * The doctor namespace is fully module-owned: types live in `./client.ts`,
 * the daemon HTTP routes live in `./doctor-control-routes.ts`,
 * `localClient(ctx)` exposes the in-process handler, and `daemonClient(link)`
 * exposes the daemon-up handler that calls the same routes through the
 * typed `DaemonTransport`.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  blank,
  type ColumnRow,
  columns,
  heading,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import type {
  DoctorCheckResult,
  DoctorClient,
  DoctorFixResult,
  DoctorRepairResult,
  DoctorRunOptions,
  DoctorRunResult,
} from "./client.js";
import {
  runDoctorFixes,
  runDoctorReport,
} from "./doctor-checks.js";
import { doctorControlRoutes } from "./doctor-control-routes.js";

export type {
  CheckResult,
  RepairResult,
} from "./doctor-checks.js";
export {
  checkProviderConnectivity,
  runDoctorChecks,
  runDoctorFixes,
  runDoctorReport,
} from "./doctor-checks.js";

function statusRole(status: DoctorCheckResult["status"]): SemanticRole {
  if (status === "pass") return "success";
  if (status === "warn") return "warn";
  return "error";
}

function buildResultsNode(results: DoctorCheckResult[]): RenderNode {
  const rows: ColumnRow[] = results.map((r) => ({
    cells: [
      { spans: [{ text: r.status, role: statusRole(r.status) }] },
      { spans: [{ text: r.label }] },
      { spans: [{ text: r.detail ?? "", role: "muted" }] },
    ],
  }));
  return columns(
    [
      { header: "Status", minWidth: 6 },
      { header: "Check", maxWidth: 36 },
      { header: "Detail", role: "muted", maxWidth: 80 },
    ],
    rows,
  );
}

function repairRole(action: DoctorRepairResult["action"]): SemanticRole {
  if (action === "repaired") return "success";
  if (action === "skipped") return "muted";
  return "warn";
}

function buildRepairsNode(repairs: DoctorRepairResult[]): RenderNode {
  return columns(
    [
      { header: "Action", minWidth: 8 },
      { header: "Item", maxWidth: 36 },
      { header: "Detail", role: "muted", maxWidth: 80 },
    ],
    repairs.map((r) => ({
      cells: [
        { spans: [{ text: r.action, role: repairRole(r.action) }] },
        { spans: [{ text: r.item }] },
        { spans: [{ text: r.detail ?? "", role: "muted" }] },
      ],
    })),
  );
}

function buildDoctorCommand(ctx: ModuleContext): Command {
  const cmd = new Command("doctor")
    .description("Run runtime health checks and print a pass/warn/fail summary")
    .option("--json", "Output results as JSON")
    .option("--fix", "Apply safe automatic repairs for fixable issues")
    .option("--skip-connectivity", "Skip provider API connectivity probes (for offline environments)")
    .option("--preset <id>", "Preflight a named preset's auth contract (overrides $KOTA_PRESET and config.defaultPreset)")
    .action(async (opts: { json?: boolean; fix?: boolean; skipConnectivity?: boolean; preset?: string }) => {
      const runOptions: { skipConnectivity?: boolean; preset?: string } = {};
      if (opts.skipConnectivity) runOptions.skipConnectivity = true;
      if (opts.preset) runOptions.preset = opts.preset;
      const runResult = await ctx.client.doctor.run(runOptions);
      const results = runResult.checks;
      const repairs = opts.fix ? (await ctx.client.doctor.fix()).repairs : [];

      if (opts.json) {
        writeJson(opts.fix ? { ...runResult, repairs } : runResult, { pretty: true });
      } else {
        const failCount = results.filter((r) => r.status === "fail").length;
        const warnCount = results.filter((r) => r.status === "warn").length;
        const nodes: RenderNode[] = [
          heading("KOTA Health Check", 1),
          blank(),
          buildResultsNode(results),
          blank(),
          line(
            span(String(results.length), "accent"),
            plain(" check(s): "),
            span(String(results.length - failCount - warnCount), "success"),
            plain(" passed, "),
            span(String(warnCount), warnCount > 0 ? "warn" : "muted"),
            plain(" warned, "),
            span(String(failCount), failCount > 0 ? "error" : "muted"),
            plain(" failed"),
          ),
        ];

        if (opts.fix) {
          const repairedCount = repairs.filter((r) => r.action === "repaired").length;
          const manualCount = repairs.filter((r) => r.action === "manual").length;
          nodes.push(
            blank(),
            heading("Auto-Repair", 2),
            blank(),
            buildRepairsNode(repairs),
            blank(),
            line(
              span(String(repairs.length), "accent"),
              plain(" repair(s): "),
              span(String(repairedCount), repairedCount > 0 ? "success" : "muted"),
              plain(" repaired, "),
              span(String(repairs.length - repairedCount - manualCount), "muted"),
              plain(" skipped, "),
              span(String(manualCount), manualCount > 0 ? "warn" : "muted"),
              plain(" require manual action"),
            ),
          );
        }
        print(stack(...nodes));
      }

      const anyFail = results.some((r) => r.status === "fail");
      if (anyFail) process.exit(1);
    });

  return cmd;
}

/**
 * Daemon-side `DoctorClient` backed by the typed `DaemonTransport`. Calls
 * the same `/doctor/run` and `/doctor/fix` HTTP routes the daemon registers
 * through `doctorControlRoutes(ctx)`. The transport surface owns the bearer
 * token, base URL, and timeout policy — this factory only encodes the wire
 * shape.
 */
function buildDoctorDaemonHandler(link: DaemonTransport): DoctorClient {
  return {
    run: async (options?: DoctorRunOptions): Promise<DoctorRunResult> => {
      const params = new URLSearchParams();
      if (options?.skipConnectivity) params.set("skipConnectivity", "true");
      if (options?.preset) params.set("preset", options.preset);
      const query = params.toString() ? `?${params.toString()}` : "";
      return link.requestStrict<DoctorRunResult>("GET", `/doctor/run${query}`);
    },
    fix: async (): Promise<DoctorFixResult> =>
      link.requestStrict<DoctorFixResult>("POST", "/doctor/fix"),
  };
}

const doctorModule: KotaModule = {
  name: "doctor",
  version: "1.0.0",
  description: "Runtime health checks — daemon, config, modules, providers, workflows, and disk",
  dependencies: ["model-clients", "rendering"],
  commands: (ctx: ModuleContext) => [buildDoctorCommand(ctx)],
  controlRoutes: (ctx) => doctorControlRoutes(ctx),
  localClient: (ctx) => {
    const doctor: DoctorClient = {
      async run(options) {
        const checkOpts: { skipConnectivity?: boolean; preset?: string } = {};
        if (options?.skipConnectivity) checkOpts.skipConnectivity = true;
        if (options?.preset) checkOpts.preset = options.preset;
        return runDoctorReport(ctx.cwd, checkOpts);
      },
      async fix() {
        return { repairs: runDoctorFixes(ctx.cwd) };
      },
    };
    return { doctor };
  },
  daemonClient: (link) => ({ doctor: buildDoctorDaemonHandler(link) }),
};

export default doctorModule;

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
import type {
  DoctorCheckResult,
  DoctorClient,
  DoctorFixResult,
  DoctorRepairResult,
  DoctorRunOptions,
  DoctorRunResult,
} from "./client.js";
import { runDoctorChecks, runDoctorFixes } from "./doctor-checks.js";
import { doctorControlRoutes } from "./doctor-control-routes.js";

export type {
  CheckResult,
  RepairResult,
} from "./doctor-checks.js";
export {
  checkProviderConnectivity,
  runDoctorChecks,
  runDoctorFixes,
} from "./doctor-checks.js";

function statusIcon(status: DoctorCheckResult["status"]): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function printResults(results: DoctorCheckResult[]): void {
  const labelWidth = Math.max(...results.map((r) => r.label.length), 10);
  for (const r of results) {
    const icon = statusIcon(r.status);
    const label = r.label.padEnd(labelWidth);
    const detail = r.detail ? `  ${r.detail}` : "";
    console.log(`  [${icon}] ${label}${detail}`);
  }
}

function repairIcon(action: DoctorRepairResult["action"]): string {
  if (action === "repaired") return "+";
  if (action === "skipped") return "·";
  return "!";
}

function printRepairs(repairs: DoctorRepairResult[]): void {
  const labelWidth = Math.max(...repairs.map((r) => r.item.length), 10);
  for (const r of repairs) {
    const icon = repairIcon(r.action);
    const label = r.item.padEnd(labelWidth);
    const detail = r.detail ? `  ${r.detail}` : "";
    console.log(`  [${icon}] ${label}${detail}`);
  }
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
        console.log(JSON.stringify(opts.fix ? { checks: results, repairs } : results, null, 2));
      } else {
        console.log("\nKOTA Health Check\n");
        printResults(results);
        const failCount = results.filter((r) => r.status === "fail").length;
        const warnCount = results.filter((r) => r.status === "warn").length;
        console.log(
          `\n${results.length} check(s): ${results.length - failCount - warnCount} passed, ${warnCount} warned, ${failCount} failed`,
        );

        if (opts.fix) {
          const repairedCount = repairs.filter((r) => r.action === "repaired").length;
          const manualCount = repairs.filter((r) => r.action === "manual").length;
          console.log("\nAuto-Repair\n");
          printRepairs(repairs);
          console.log(
            `\n${repairs.length} repair(s): ${repairedCount} repaired, ${repairs.length - repairedCount - manualCount} skipped, ${manualCount} require manual action`,
          );
        }
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
  dependencies: ["model-clients"],
  commands: (ctx: ModuleContext) => [buildDoctorCommand(ctx)],
  controlRoutes: (ctx) => doctorControlRoutes(ctx),
  localClient: (ctx) => {
    const doctor: DoctorClient = {
      async run(options) {
        const checkOpts: { skipConnectivity?: boolean; preset?: string } = {};
        if (options?.skipConnectivity) checkOpts.skipConnectivity = true;
        if (options?.preset) checkOpts.preset = options.preset;
        const checks = await runDoctorChecks(ctx.cwd, checkOpts);
        return { checks };
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

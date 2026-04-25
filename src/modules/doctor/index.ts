/**
 * Doctor module — owns the `kota doctor` CLI health check surface.
 *
 * Registers the `kota doctor` command that runs pass/warn/fail checks
 * against daemon connectivity, config validity, modules, providers,
 * workflow definitions, and disk state. The CLI handler routes through
 * `ctx.client.doctor.{run,fix}()` so daemon-up and daemon-down operators
 * see the same diagnostics for the same project state.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type {
  DoctorCheckResult,
  DoctorClient,
  DoctorRepairResult,
} from "#core/server/kota-client.js";
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
    .action(async (opts: { json?: boolean; fix?: boolean; skipConnectivity?: boolean }) => {
      const runOptions: { skipConnectivity?: boolean } = {};
      if (opts.skipConnectivity) runOptions.skipConnectivity = true;
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
        const checkOpts: { skipConnectivity?: boolean } = {};
        if (options?.skipConnectivity) checkOpts.skipConnectivity = true;
        const checks = await runDoctorChecks(ctx.cwd, checkOpts);
        return { checks };
      },
      async fix() {
        return { repairs: runDoctorFixes(ctx.cwd) };
      },
    };
    return { doctor };
  },
};

export default doctorModule;

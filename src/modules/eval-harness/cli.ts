/**
 * `kota eval` CLI surface.
 *
 * Operators run `kota eval run` to execute a fixture or a full set against
 * the current project's subprocess workflow trigger. Results land as run
 * artifacts under `.kota/eval-runs/`; the aggregate score is also echoed to
 * stdout for CI consumption.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { EventBus } from "#core/events/event-bus.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";
import { runEvalSet } from "./eval-set.js";
import { loadAllFixtures, loadFixture } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

const DEFAULT_HOST_CLASS = "local-dev";
const DEFAULT_CPU_ALLOC = 2;
const DEFAULT_MEM_ALLOC_MB = 4096;

function parsePositiveInt(raw: string, name: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

function resolveProfile(opts: {
  hostClass?: string;
  cpuAllocation?: string;
  cpuKill?: string;
  memoryAllocation?: string;
  memoryKill?: string;
}): ResourceProfile {
  const cpuAllocationCores = opts.cpuAllocation
    ? Number.parseFloat(opts.cpuAllocation)
    : DEFAULT_CPU_ALLOC;
  const cpuKillThresholdCores = opts.cpuKill
    ? Number.parseFloat(opts.cpuKill)
    : cpuAllocationCores;
  const memoryAllocationMB = opts.memoryAllocation
    ? parsePositiveInt(opts.memoryAllocation, "memory-allocation-mb")
    : DEFAULT_MEM_ALLOC_MB;
  const memoryKillThresholdMB = opts.memoryKill
    ? parsePositiveInt(opts.memoryKill, "memory-kill-threshold-mb")
    : memoryAllocationMB;
  return {
    hostClass: opts.hostClass ?? DEFAULT_HOST_CLASS,
    cpuAllocationCores,
    cpuKillThresholdCores,
    memoryAllocationMB,
    memoryKillThresholdMB,
  };
}

export function buildEvalCommand(projectDir: string): Command {
  const fixturesRoot = join(projectDir, "src/modules/eval-harness/fixtures");
  const evalRunsRoot = join(projectDir, ".kota/eval-runs");
  const kotaBinaryPath = resolve(join(projectDir, "bin/kota.mjs"));

  const cmd = new Command("eval").description(
    "Run the autonomy eval harness against a fixture or fixture set.",
  );

  cmd
    .command("list")
    .description("List all discovered fixtures under the eval-harness module.")
    .action(() => {
      const fixtures = loadAllFixtures(fixturesRoot);
      if (fixtures.length === 0) {
        console.log("No fixtures found.");
        return;
      }
      for (const f of fixtures) {
        const tags = f.spec.tags && f.spec.tags.length > 0 ? ` [${f.spec.tags.join(", ")}]` : "";
        console.log(`${f.spec.id}  (${f.spec.role} → ${f.spec.workflowName})${tags}`);
        console.log(`  ${f.spec.description}`);
      }
    });

  cmd
    .command("run")
    .description("Execute one fixture or the full set via the subprocess executor.")
    .option("--fixture <id>", "Run only the fixture with this id (repeatable)", (v, prev: string[]) => [...prev, v], [] as string[])
    .option("--repeats <n>", "Repeat each fixture N times (default 3)", "3")
    .option("--host-class <name>", "Host class label recorded on every run")
    .option("--cpu-allocation <cores>", "Guaranteed CPU cores per run")
    .option("--cpu-kill <cores>", "Hard CPU ceiling per run (defaults to allocation)")
    .option("--memory-allocation-mb <mb>", "Guaranteed memory per run in MB")
    .option("--memory-kill-threshold-mb <mb>", "Hard memory ceiling per run in MB")
    .option("--keep", "Keep fixture working directories for post-mortem")
    .action(async (opts: {
      fixture: string[];
      repeats: string;
      hostClass?: string;
      cpuAllocation?: string;
      cpuKill?: string;
      memoryAllocationMb?: string;
      memoryKillThresholdMb?: string;
      keep?: boolean;
    }) => {
      const repeats = parsePositiveInt(opts.repeats, "repeats");
      const profile = resolveProfile({
        hostClass: opts.hostClass,
        cpuAllocation: opts.cpuAllocation,
        cpuKill: opts.cpuKill,
        memoryAllocation: opts.memoryAllocationMb,
        memoryKill: opts.memoryKillThresholdMb,
      });
      const fixtures = opts.fixture.length > 0
        ? opts.fixture.map((id) => loadFixture(fixturesRoot, id))
        : loadAllFixtures(fixturesRoot);
      if (fixtures.length === 0) {
        console.error(`No fixtures to run under "${fixturesRoot}".`);
        process.exitCode = 1;
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const runArtifactBaseDir = join(evalRunsRoot, stamp);
      mkdirSync(runArtifactBaseDir, { recursive: true });

      const bus = new EventBus();
      const executor = createSubprocessExecutor({ kotaBinaryPath });
      const report = await runEvalSet({
        fixtures,
        executor,
        resourceProfile: profile,
        runArtifactBaseDir: realpathSync(runArtifactBaseDir),
        repeatCount: repeats,
        keepWorkingDirs: opts.keep ?? false,
      });

      bus.emit("eval-harness.set.completed", {
        fixtureCount: report.aggregate.fixtureCount,
        repeatCount: report.repeatCount,
        passAtK: report.aggregate.passAtK,
        passHatK: report.aggregate.passHatK,
        hostClass: profile.hostClass,
        runArtifactBaseDir: report.runArtifactBaseDir,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
      });

      console.log(
        `eval-set done: ${fixtures.length} fixtures × ${repeats} runs → pass@k=${(report.aggregate.passAtK * 100).toFixed(1)}% pass^k=${(report.aggregate.passHatK * 100).toFixed(1)}%`,
      );
      console.log(`artifacts: ${report.runArtifactBaseDir}`);
      if (report.aggregate.passHatK < 1) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("calibration")
    .description(
      "Summarize live-run evaluator calibration across a rolling window of run artifacts.",
    )
    .option("--window-days <n>", "Window size in days (default 7)", "7")
    .option(
      "--follow-up-days <n>",
      "Follow-up fingerprint window in days (default 3)",
      "3",
    )
    .option(
      "--threshold-rate <r>",
      `Pass-verdict contradiction rate that triggers the gate (default ${DEFAULT_CALIBRATION_THRESHOLD_RATE})`,
      `${DEFAULT_CALIBRATION_THRESHOLD_RATE}`,
    )
    .option(
      "--min-sample <n>",
      `Minimum pass verdicts before the gate can fire (default ${DEFAULT_CALIBRATION_MIN_SAMPLE})`,
      `${DEFAULT_CALIBRATION_MIN_SAMPLE}`,
    )
    .option(
      "--runs-dir <path>",
      "Override runs directory (default <projectDir>/.kota/runs)",
    )
    .option("--json", "Emit the aggregate + decision as JSON for CI consumption")
    .action((opts: {
      windowDays: string;
      followUpDays: string;
      thresholdRate: string;
      minSample: string;
      runsDir?: string;
      json?: boolean;
    }) => {
      const windowDays = Number.parseFloat(opts.windowDays);
      const followUpDays = Number.parseFloat(opts.followUpDays);
      const thresholdRate = Number.parseFloat(opts.thresholdRate);
      const minSample = parsePositiveInt(opts.minSample, "min-sample");
      if (!(windowDays > 0)) throw new Error("--window-days must be positive.");
      if (!(followUpDays > 0)) throw new Error("--follow-up-days must be positive.");
      if (!(thresholdRate >= 0 && thresholdRate <= 1)) {
        throw new Error("--threshold-rate must be between 0 and 1.");
      }

      const runsDir = opts.runsDir ?? join(projectDir, ".kota", "runs");
      const dayMs = 24 * 60 * 60 * 1000;
      const aggregate = aggregateCalibration(runsDir, {
        windowMs: windowDays * dayMs,
        followUpWindowMs: followUpDays * dayMs,
      });
      const decision = evaluateCalibrationGate(aggregate, {
        thresholdRate,
        minSample,
      });

      if (opts.json) {
        console.log(JSON.stringify({ aggregate, decision }, null, 2));
      } else {
        const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
        console.log(`evaluator calibration (window ${windowDays}d):`);
        console.log(
          `  total runs=${aggregate.totalRuns}  pass=${aggregate.byVerdict.pass}  pass_with_warnings=${aggregate.byVerdict.pass_with_warnings}  fail=${aggregate.byVerdict.fail}  absent=${aggregate.byVerdict.absent}`,
        );
        console.log(
          `  pass contradiction: ${aggregate.passContradictionCount}/${aggregate.byVerdict.pass} (${pct(aggregate.passContradictionRate)})`,
        );
        console.log(
          `  pass_with_warnings follow-up: ${aggregate.passWithWarningsFollowUpCount}/${aggregate.byVerdict.pass_with_warnings} (${pct(aggregate.passWithWarningsFollowUpRate)})`,
        );
        console.log(`  gate: ${decision.status} — ${decision.reason}`);
      }

      if (decision.status === "gated") {
        process.exitCode = 2;
      }
    });

  return cmd;
}

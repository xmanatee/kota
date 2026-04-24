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
import {
  blank,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { runEvalSet } from "./eval-set.js";
import { FixtureProvenanceError, loadAllFixtures, loadFixture } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { extractAgentStepRecording } from "./recorder.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

function loadFixturesForCli(
  fixturesRoot: string,
  ids: readonly string[],
): ReturnType<typeof loadAllFixtures> | null {
  try {
    return ids.length > 0
      ? ids.map((id) => loadFixture(fixturesRoot, id))
      : loadAllFixtures(fixturesRoot);
  } catch (err) {
    if (err instanceof FixtureProvenanceError) {
      console.error(`eval-harness fixture provenance error: ${err.message}`);
      console.error(`  offending fixture directory: ${err.fixtureDir}`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }
}

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
      const fixtures = loadFixturesForCli(fixturesRoot, []);
      if (fixtures === null) return;
      if (fixtures.length === 0) {
        print(line(plain("No fixtures found.")));
        return;
      }
      const rows = fixtures.flatMap((f) => {
        const tags = f.spec.tags && f.spec.tags.length > 0
          ? ` [${f.spec.tags.join(", ")}]`
          : "";
        return [
          line(
            span(f.spec.id, "accent", true),
            plain("  ("),
            span(f.spec.role, "info"),
            plain(" → "),
            span(f.spec.workflowName, "agent"),
            plain(")"),
            span(tags, "muted"),
          ),
          line(span(`  ${f.spec.description}`, "muted")),
        ];
      });
      print(stack(...rows));
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
      const fixtures = loadFixturesForCli(fixturesRoot, opts.fixture);
      if (fixtures === null) return;
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

      const passAtK = report.aggregate.passAtK;
      const passHatK = report.aggregate.passHatK;
      const passRole = passHatK >= 1 ? "success" : passHatK > 0 ? "warn" : "error";
      print(stack(
        line(
          plain("eval-set done: "),
          span(String(fixtures.length), "accent"),
          plain(" fixtures × "),
          span(String(repeats), "accent"),
          plain(" runs → pass@k="),
          span(`${(passAtK * 100).toFixed(1)}%`, "info"),
          plain(" pass^k="),
          span(`${(passHatK * 100).toFixed(1)}%`, passRole),
        ),
        line(span(`artifacts: ${report.runArtifactBaseDir}`, "muted")),
      ));
      if (report.aggregate.passHatK < 1) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("record-agent-step")
    .description(
      "Extract an agent-step recording from a real .kota/runs/<id>/steps/<step>/ artifact into a fixture.",
    )
    .requiredOption("--run-id <id>", "Source run id under .kota/runs/")
    .requiredOption("--step <id>", "Agent step id to extract (e.g. decompose)")
    .requiredOption(
      "--fixture <id>",
      "Target fixture id under src/modules/eval-harness/fixtures/",
    )
    .action((opts: { runId: string; step: string; fixture: string }) => {
      const fixtureDir = join(fixturesRoot, opts.fixture);
      const result = extractAgentStepRecording({
        projectDir,
        sourceRunId: opts.runId,
        stepId: opts.step,
        fixtureDir,
      });
      print(stack(
        line(
          plain("wrote recording: "),
          span(result.recordingPath, "accent"),
        ),
        line(
          plain("  workflow="),
          span(result.recording.workflowName, "info"),
          plain("  step="),
          span(result.recording.stepId, "info"),
          plain("  source="),
          span(result.recording.sourceRunId, "muted"),
          plain("  sourceCommit="),
          span(result.sourceCommitSha.slice(0, 12), "muted"),
        ),
        line(
          plain("  response turns="),
          span(String(result.recording.response.turns), "info"),
          plain(" totalCostUsd="),
          span(result.recording.response.totalCostUsd.toFixed(6), "info"),
        ),
        line(
          plain("  file operations extracted: "),
          span(String(result.recording.fileOperations.length), "accent"),
        ),
        ...(result.skippedWritesOutsideProject.length > 0
          ? [
              line(
                span(
                  `  skipped ${result.skippedWritesOutsideProject.length} path(s) outside the project (audit if relevant):`,
                  "warn",
                ),
              ),
              ...result.skippedWritesOutsideProject.map((p) =>
                line(span(`    ${p}`, "muted")),
              ),
            ]
          : []),
      ));
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
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify({ aggregate, decision }, null, 2));
      } else {
        const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
        const gateRole = decision.status === "gated"
          ? "error"
          : decision.status === "under-threshold"
            ? "success"
            : "warn";
        print(stack(
          line(
            plain("evaluator calibration (window "),
            span(`${windowDays}d`, "accent"),
            plain("):"),
          ),
          line(
            plain("  total runs="),
            span(String(aggregate.totalRuns), "info"),
            plain("  pass="),
            span(String(aggregate.byVerdict.pass), "success"),
            plain("  pass_with_warnings="),
            span(String(aggregate.byVerdict.pass_with_warnings), "warn"),
            plain("  fail="),
            span(String(aggregate.byVerdict.fail), "error"),
            plain("  absent="),
            span(String(aggregate.byVerdict.absent), "muted"),
          ),
          line(
            plain("  pass contradiction: "),
            plain(`${aggregate.passContradictionCount}/${aggregate.byVerdict.pass} `),
            span(`(${pct(aggregate.passContradictionRate)})`, "muted"),
          ),
          line(
            plain("  pass_with_warnings follow-up: "),
            plain(`${aggregate.passWithWarningsFollowUpCount}/${aggregate.byVerdict.pass_with_warnings} `),
            span(`(${pct(aggregate.passWithWarningsFollowUpRate)})`, "muted"),
          ),
          blank(),
          line(
            plain("  gate: "),
            span(decision.status, gateRole, true),
            plain(` — ${decision.reason}`),
          ),
        ));
      }

      if (decision.status === "gated") {
        process.exitCode = 2;
      }
    });

  return cmd;
}

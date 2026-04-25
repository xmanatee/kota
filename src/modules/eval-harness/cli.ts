/**
 * `kota eval` CLI surface.
 *
 * Operators run `kota eval run` to execute a fixture or a full set against
 * the current project's subprocess workflow trigger. CLI subcommands route
 * through `ctx.client.evalHarness.<method>()` so daemon-up and daemon-down
 * operators see the same fixture set, run report shape, and calibration
 * aggregate. The `record-agent-step` developer subcommand stays local —
 * it extracts a fixture from a project run artifact and is not part of the
 * operator KotaClient surface.
 */

import { join } from "node:path";
import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  EvalCalibrationOptions,
  EvalRunOptions,
} from "#core/server/kota-client.js";
import {
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
} from "#modules/autonomy/evaluator-calibration.js";
import {
  blank,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import {
  extractAgentStepRecording,
  extractJudgeCallRecording,
} from "./recorder.js";

function parsePositiveInt(raw: string, name: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

export function buildEvalCommand(ctx: ModuleContext): Command {
  const cmd = new Command("eval").description(
    "Run the autonomy eval harness against a fixture or fixture set.",
  );

  cmd
    .command("list")
    .description("List all discovered fixtures under the eval-harness module.")
    .action(async () => {
      const result = await ctx.client.evalHarness.list();
      if (result.fixtures.length === 0) {
        print(line(plain("No fixtures found.")));
        return;
      }
      const rows = result.fixtures.flatMap((f) => {
        const tags = f.tags.length > 0 ? ` [${f.tags.join(", ")}]` : "";
        return [
          line(
            span(f.id, "accent", true),
            plain("  ("),
            span(f.role, "info"),
            plain(" → "),
            span(f.workflowName, "agent"),
            plain(")"),
            span(tags, "muted"),
          ),
          line(span(`  ${f.description}`, "muted")),
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
      const runOptions: EvalRunOptions = {
        repeatCount: repeats,
        ...(opts.fixture.length > 0 && { fixtureIds: opts.fixture }),
        ...(opts.hostClass !== undefined && { hostClass: opts.hostClass }),
        ...(opts.cpuAllocation !== undefined && {
          cpuAllocationCores: Number.parseFloat(opts.cpuAllocation),
        }),
        ...(opts.cpuKill !== undefined && {
          cpuKillThresholdCores: Number.parseFloat(opts.cpuKill),
        }),
        ...(opts.memoryAllocationMb !== undefined && {
          memoryAllocationMB: parsePositiveInt(opts.memoryAllocationMb, "memory-allocation-mb"),
        }),
        ...(opts.memoryKillThresholdMb !== undefined && {
          memoryKillThresholdMB: parsePositiveInt(opts.memoryKillThresholdMb, "memory-kill-threshold-mb"),
        }),
        ...(opts.keep === true && { keepWorkingDirs: true }),
      };
      const result = await ctx.client.evalHarness.run(runOptions);
      if (!result.ok) {
        if (result.reason === "fixture_provenance") {
          console.error(`eval-harness fixture provenance error: ${result.message}`);
        } else {
          console.error(result.message);
        }
        process.exitCode = 1;
        return;
      }

      const passAtK = result.passAtK;
      const passHatK = result.passHatK;
      const passRole = passHatK >= 1 ? "success" : passHatK > 0 ? "warn" : "error";
      print(stack(
        line(
          plain("eval-set done: "),
          span(String(result.fixtureCount), "accent"),
          plain(" fixtures × "),
          span(String(result.repeatCount), "accent"),
          plain(" runs → pass@k="),
          span(`${(passAtK * 100).toFixed(1)}%`, "info"),
          plain(" pass^k="),
          span(`${(passHatK * 100).toFixed(1)}%`, passRole),
        ),
        line(span(`artifacts: ${result.runArtifactBaseDir}`, "muted")),
      ));
      if (passHatK < 1) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("record-agent-step")
    .description(
      "Extract an agent-step or judge-call recording from a real .kota/runs/<id>/ artifact into a fixture.",
    )
    .requiredOption("--run-id <id>", "Source run id under .kota/runs/")
    .option("--step <id>", "Agent step id to extract (e.g. decompose) — mutually exclusive with --judge")
    .option(
      "--judge <label>",
      "Judge artifact label to extract (e.g. critic-review, semantic-gate-review); reads <runDir>/<label>.json — mutually exclusive with --step",
    )
    .requiredOption(
      "--fixture <id>",
      "Target fixture id under src/modules/eval-harness/fixtures/",
    )
    .option(
      "--source-commit-sha <sha>",
      "Override for the source commit SHA; use when steps/commit.json reports committed=true but pre-dates the SHA capture. Ignored with --judge (judges have no commit).",
    )
    .action((opts: { runId: string; step?: string; judge?: string; fixture: string; sourceCommitSha?: string }) => {
      const fixturesRoot = join(ctx.cwd, "src/modules/eval-harness/fixtures");
      const fixtureDir = join(fixturesRoot, opts.fixture);
      if (!opts.step === !opts.judge) {
        throw new Error(
          "record-agent-step requires exactly one of --step or --judge.",
        );
      }
      if (opts.judge !== undefined) {
        const result = extractJudgeCallRecording({
          projectDir: ctx.cwd,
          sourceRunId: opts.runId,
          label: opts.judge,
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
            plain("  judge="),
            span(result.recording.stepId, "info"),
            plain("  source="),
            span(result.recording.sourceRunId, "muted"),
          ),
        ));
        return;
      }
      const result = extractAgentStepRecording({
        projectDir: ctx.cwd,
        sourceRunId: opts.runId,
        stepId: opts.step!,
        fixtureDir,
        ...(opts.sourceCommitSha !== undefined && {
          explicitCommitSha: opts.sourceCommitSha,
        }),
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
    .action(async (opts: {
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

      const calibrationOptions: EvalCalibrationOptions = {
        windowDays,
        followUpDays,
        thresholdRate,
        minSample,
        ...(opts.runsDir !== undefined && { runsDir: opts.runsDir }),
      };
      const { aggregate, decision } = await ctx.client.evalHarness.calibration(calibrationOptions);

      if (opts.json) {
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify({ aggregate, decision }, null, 2));
      } else {
        const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
        const a = aggregate as {
          totalRuns: number;
          byVerdict: { pass: number; pass_with_warnings: number; fail: number; absent: number };
          passContradictionCount: number;
          passContradictionRate: number;
          passWithWarningsFollowUpCount: number;
          passWithWarningsFollowUpRate: number;
        };
        const d = decision as { status: string; reason: string };
        const gateRole = d.status === "gated"
          ? "error"
          : d.status === "under-threshold"
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
            span(String(a.totalRuns), "info"),
            plain("  pass="),
            span(String(a.byVerdict.pass), "success"),
            plain("  pass_with_warnings="),
            span(String(a.byVerdict.pass_with_warnings), "warn"),
            plain("  fail="),
            span(String(a.byVerdict.fail), "error"),
            plain("  absent="),
            span(String(a.byVerdict.absent), "muted"),
          ),
          line(
            plain("  pass contradiction: "),
            plain(`${a.passContradictionCount}/${a.byVerdict.pass} `),
            span(`(${pct(a.passContradictionRate)})`, "muted"),
          ),
          line(
            plain("  pass_with_warnings follow-up: "),
            plain(`${a.passWithWarningsFollowUpCount}/${a.byVerdict.pass_with_warnings} `),
            span(`(${pct(a.passWithWarningsFollowUpRate)})`, "muted"),
          ),
          blank(),
          line(
            plain("  gate: "),
            span(d.status, gateRole, true),
            plain(` — ${d.reason}`),
          ),
        ));
      }

      if (decision.status === "gated") {
        process.exitCode = 2;
      }
    });

  return cmd;
}

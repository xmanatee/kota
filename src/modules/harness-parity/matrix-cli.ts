import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { parseCliNumber } from "#modules/eval-harness/cli-numeric-options.js";
import {
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";
import type {
  HarnessParityMatrixOptions,
  HarnessParityMatrixRow,
} from "./client.js";
import { validateMatrixIsolationBackends } from "./model-matrix-isolation.js";

type MatrixCommandOptions = {
  scenario: string[];
  harness: string[];
  baseline: string[];
  candidate: string[];
  candidateSet: string[];
  evalFixture: string[];
  evalIsolationBackends?: string;
  repeats: string;
  maxTurns?: string;
  effort?: string;
  out?: string;
  keep?: boolean;
  hostClass?: string;
  cpuAllocationCores?: string;
  cpuKillThresholdCores?: string;
  memoryAllocationMb?: string;
  memoryKillThresholdMb?: string;
};

export function registerHarnessParityMatrixCommand(
  cmd: Command,
  ctx: ModuleContext,
): void {
  cmd
    .command("matrix")
    .description(
      "Run baseline and candidate model rows over harness-parity scenarios and selected eval fixtures.",
    )
    .option(
      "--scenario <id>",
      "Run only the scenario with this id (repeatable)",
      appendStringOption,
      [] as string[],
    )
    .option(
      "--harness <name>",
      "Select compatible harnesses (repeatable; defaults to each model’s preset/provider route)",
      appendStringOption,
      [] as string[],
    )
    .option(
      "--baseline <model>",
      "Baseline model (repeatable; defaults to the active preset model)",
      appendStringOption,
      [] as string[],
    )
    .option(
      "--candidate <model>",
      "Candidate model (repeatable)",
      appendStringOption,
      [] as string[],
    )
    .option(
      "--candidate-set <id>",
      "Expand a shipped candidate set, e.g. openrouter-lab (repeatable)",
      appendStringOption,
      [] as string[],
    )
    .option(
      "--eval-fixture <id>",
      "Run an eval-harness fixture id through eval-harness resource-profile rules (repeatable)",
      appendStringOption,
      [] as string[],
    )
    .option("--repeats <n>", "Sequential repeats per row", "1")
    .option("--eval-isolation-backends <json>", "Eval isolation settings by resolved provider; same backend schema as eval run")
    .option(
      "--max-turns <n>",
      "Upper turn bound for iterating harnesses (ignored by thin)",
    )
    .option(
      "--effort <level>",
      "Neutral effort level: low, medium, high, xhigh, or max",
    )
    .option("--out <dir>", "Override output directory for matrix artifacts")
    .option("--keep", "Keep materialized working directories for inspection")
    .option("--host-class <name>", "Eval-harness resource profile host class")
    .option(
      "--cpu-allocation-cores <n>",
      "Eval-harness requested CPU allocation",
    )
    .option(
      "--cpu-kill-threshold-cores <n>",
      "Eval-harness requested CPU kill threshold",
    )
    .option(
      "--memory-allocation-mb <n>",
      "Eval-harness requested memory allocation",
    )
    .option(
      "--memory-kill-threshold-mb <n>",
      "Eval-harness requested memory kill threshold",
    )
    .action((opts: MatrixCommandOptions) => runMatrixCommand(ctx, opts));
}

async function runMatrixCommand(
  ctx: ModuleContext,
  opts: MatrixCommandOptions,
): Promise<void> {
  const repeats = parseCliNumber(opts.repeats, "repeats", "positive integer");
  const maxTurns =
    opts.maxTurns === undefined
      ? undefined
      : parseCliNumber(opts.maxTurns, "max-turns", "positive integer");
  const effort = parseEffort(opts.effort);
  const cpuAllocationCores = opts.cpuAllocationCores === undefined
    ? undefined
    : parseCliNumber(opts.cpuAllocationCores, "cpu-allocation-cores", "positive number");
  const cpuKillThresholdCores = opts.cpuKillThresholdCores === undefined
    ? undefined
    : parseCliNumber(opts.cpuKillThresholdCores, "cpu-kill-threshold-cores", "positive number");
  const memoryAllocationMB = opts.memoryAllocationMb === undefined
    ? undefined
    : parseCliNumber(opts.memoryAllocationMb, "memory-allocation-mb", "positive number");
  const memoryKillThresholdMB = opts.memoryKillThresholdMb === undefined
    ? undefined
    : parseCliNumber(opts.memoryKillThresholdMb, "memory-kill-threshold-mb", "positive number");

  const result = await ctx.client.harnessParity.matrix({
    ...(opts.scenario.length > 0 && { scenarios: opts.scenario }),
    ...(opts.harness.length > 0 && { harnesses: opts.harness }),
    ...(opts.baseline.length > 0 && {
      baselines: opts.baseline.map((model) => ({ model })),
    }),
    ...(opts.candidate.length > 0 && {
      candidates: opts.candidate.map((model) => ({ model })),
    }),
    ...(opts.candidateSet.length > 0 && {
      candidateSets: opts.candidateSet,
    }),
    ...(opts.evalFixture.length > 0 && { evalFixtures: opts.evalFixture }),
    ...(opts.evalIsolationBackends !== undefined && {
      evalIsolationBackends: validateMatrixIsolationBackends(JSON.parse(opts.evalIsolationBackends)),
    }),
    repeats,
    ...(maxTurns !== undefined && { maxTurns }),
    ...(effort !== undefined && { effort }),
    ...(opts.out !== undefined && { outDir: opts.out }),
    ...(opts.keep !== undefined && { keepWorkingDir: opts.keep }),
    ...(opts.hostClass !== undefined && { hostClass: opts.hostClass }),
    ...(cpuAllocationCores !== undefined && { cpuAllocationCores }),
    ...(cpuKillThresholdCores !== undefined && { cpuKillThresholdCores }),
    ...(memoryAllocationMB !== undefined && { memoryAllocationMB }),
    ...(memoryKillThresholdMB !== undefined && { memoryKillThresholdMB }),
  });

  if (!result.ok) {
    printToStderr(
      line(
        span(
          `harness-parity matrix failed (${result.reason}): ${result.message}`,
          "error",
        ),
      ),
    );
    process.exitCode = 1;
    return;
  }

  print(
    stack(
      line(
        plain("model matrix: "),
        span(String(result.aggregate.runnableGroupCount), "accent"),
        plain(" runnable groups, "),
        span(String(result.aggregate.skippedGroupCount), "warn"),
        plain(" skipped groups; pass@k="),
        span(formatRate(result.aggregate.passAtK), "info"),
        plain(" pass^k="),
        span(formatRate(result.aggregate.passHatK), "info"),
      ),
      line(span(`report: ${result.reportPath}`, "muted")),
    ),
  );

  for (const row of result.rows) {
    printMatrixRow(row);
  }

  const failedRunnable = result.rows.some(
    (row) => row.status === "failed" || row.status === "error",
  );
  if (failedRunnable) process.exitCode = 1;
}

function appendStringOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseEffort(
  raw: string | undefined,
): HarnessParityMatrixOptions["effort"] {
  if (raw === undefined) return undefined;
  if (
    raw === "low" ||
    raw === "medium" ||
    raw === "high" ||
    raw === "xhigh" ||
    raw === "max"
  ) {
    return raw;
  }
  throw new Error(
    `--effort must be low, medium, high, xhigh, or max, got "${raw}".`,
  );
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function printMatrixRow(row: HarnessParityMatrixRow): void {
  const role = matrixRowRole(row);
  const verification =
    row.verification === null
      ? "not-run"
      : row.verification.passed
        ? "pass"
        : "fail";
  print(
    line(
      span(row.role, row.role === "baseline" ? "info" : "agent"),
      plain(" "),
      span(row.label, "accent"),
      plain(" "),
      span(row.harnessName, "muted"),
      plain("/"),
      span(row.scenarioId, "muted"),
      plain(` r${row.repeatIndex + 1}: `),
      span(row.status, role),
      plain(" verification="),
      span(verification, role),
      row.skipReason ? plain(` (${row.skipReason})`) : plain(""),
    ),
  );
}

function matrixRowRole(row: HarnessParityMatrixRow): "success" | "warn" | "error" {
  if (row.status === "passed") return "success";
  if (row.status === "skipped") return "warn";
  return "error";
}

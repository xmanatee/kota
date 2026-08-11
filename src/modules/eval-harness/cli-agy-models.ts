import { isAbsolute } from "node:path";
import type { Command } from "commander";
import type { AgentEffort } from "#core/agent-harness/index.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import {
  print,
  printToStderr,
  writeJson,
} from "#modules/rendering/transport.js";
import { requireAgyModelEvaluationIsolation } from "./agy-model-evaluation-isolation.js";
import type { AgyModelEvaluationOptions } from "./agy-model-evaluation-types.js";
import { validateProviderEgressProxyUrl } from "./provider-egress.js";

type AgyModelsCliOptions = {
  candidate: string[];
  repeats: string;
  effort: string;
  hostClass?: string;
  containerExecutable?: string;
  containerImage?: string;
  containerKotaBinaryPath?: string;
  providerEgressNetwork?: string;
  providerEgressProxy?: string;
  keep?: boolean;
  json?: boolean;
};

function parseRepeatCount(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--repeats must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

function resolveAgyCliIsolation(
  opts: AgyModelsCliOptions,
): AgyModelEvaluationOptions["isolationBackend"] {
  if (
    !opts.containerExecutable ||
    !opts.containerImage ||
    !opts.containerKotaBinaryPath
  ) {
    throw new Error(
      "AGY model evaluation requires --container-executable, --container-image, and --container-kota-binary-path.",
    );
  }
  if (!isAbsolute(opts.containerKotaBinaryPath)) {
    throw new Error(
      "--container-kota-binary-path must be an absolute path inside the container image.",
    );
  }
  if (!opts.providerEgressNetwork) {
    throw new Error(
      "AGY model evaluation requires --provider-egress-network.",
    );
  }
  if (!opts.providerEgressProxy) {
    throw new Error("AGY model evaluation requires --provider-egress-proxy.");
  }
  validateProviderEgressProxyUrl(opts.providerEgressProxy);
  return requireAgyModelEvaluationIsolation({
    kind: "container",
    executable: opts.containerExecutable,
    image: opts.containerImage,
    kotaBinaryPath: opts.containerKotaBinaryPath,
    networkPolicy: {
      kind: "provider-egress",
      provider: "google",
      enforcement: {
        kind: "docker-internal-proxy",
        networkName: opts.providerEgressNetwork,
        proxyUrl: opts.providerEgressProxy,
      },
    },
  });
}

function candidateRows(
  result: Extract<
    Awaited<ReturnType<ModuleContext["client"]["evalHarness"]["runAgyModels"]>>,
    { ok: true }
  >,
) {
  return result.report.candidates.flatMap((candidate) => [
    line(
      span(candidate.model, "accent", true),
      plain(" rubric="),
      span(
        candidate.rubricScore.toFixed(1),
        candidate.passed ? "success" : "error",
      ),
      plain(" pass@k="),
      span(`${(candidate.passAtK * 100).toFixed(1)}%`, "info"),
      plain(" pass^k="),
      span(
        `${(candidate.passHatK * 100).toFixed(1)}%`,
        candidate.passed ? "success" : "error",
      ),
    ),
    ...candidate.scenarioVerdicts.map((verdict) =>
      line(
        plain("  "),
        span(verdict.scenario, "info"),
        plain(" "),
        span(
          verdict.passed ? "pass" : "fail",
          verdict.passed ? "success" : "error",
        ),
        plain(` rubric=${verdict.rubric.score.toFixed(1)}`),
        plain(` changed=${verdict.changedPathScope.changedPaths.length}`),
      ),
    ),
  ]);
}

export function registerAgyModelsCommand(
  command: Command,
  ctx: ModuleContext,
): void {
  command
    .command("agy-models")
    .description(
      "Run the planning, scoped-coding, and repair suite against AGY candidate models.",
    )
    .requiredOption(
      "--candidate <model>",
      "AGY model id to evaluate (repeatable)",
      (value, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--repeats <n>", "Repeat each scenario N times (default 1)", "1")
    .option("--effort <effort>", "KOTA effort (must be max)", "max")
    .option("--host-class <name>", "Host class label recorded on every run")
    .option("--container-executable <path>", "Docker-compatible executable used for isolated AGY runs")
    .option("--container-image <image>", "Container image containing KOTA and antigravity-cli")
    .option("--container-kota-binary-path <path>", "Absolute path to bin/kota.mjs inside the container image")
    .option("--provider-egress-network <name>", "Docker internal network enforcing Google provider egress")
    .option("--provider-egress-proxy <url>", "HTTP proxy URL reachable from the provider-egress Docker network")
    .option("--keep", "Keep isolated scenario working directories")
    .option("--json", "Emit the complete suite report as JSON")
    .action(async (opts: AgyModelsCliOptions) => {
      const options: AgyModelEvaluationOptions = {
        candidates: opts.candidate,
        repeatCount: parseRepeatCount(opts.repeats),
        effort: opts.effort as AgentEffort,
        isolationBackend: resolveAgyCliIsolation(opts),
        ...(opts.hostClass !== undefined && { hostClass: opts.hostClass }),
        ...(opts.keep === true && { keepWorkingDirs: true }),
      };
      const result = await ctx.client.evalHarness.runAgyModels(options);
      if (opts.json) writeJson(result, { pretty: true });
      if (!result.ok) {
        if (!opts.json) {
          printToStderr(line(span(result.message, "error")));
          if (result.artifactDir !== null) {
            printToStderr(
              line(span(`artifacts: ${result.artifactDir}`, "muted")),
            );
          }
        }
        process.exitCode = 1;
        return;
      }
      const failed = result.report.candidates.some(
        (candidate) => !candidate.passed,
      );
      if (opts.json) {
        if (failed) process.exitCode = 1;
        return;
      }
      print(
        stack(
          line(
            plain("AGY model evaluation: "),
            span(result.report.harness, "agent"),
            plain(" effort="),
            span(result.report.effort, "info"),
            plain(" (AGY "),
            span(result.report.nativeEffort, "info"),
            plain(")"),
          ),
          ...candidateRows(result),
          line(span(`artifacts: ${result.report.artifactDir}`, "muted")),
        ),
      );
      if (failed) process.exitCode = 1;
    });
}

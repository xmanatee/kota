/**
 * `kota harness-parity` CLI surface.
 *
 * Operators run `kota harness-parity run` to execute scenarios across every
 * registered harness and capture paired artifacts under `.kota/runs/`.
 * Reads (`list`) and the run itself flow through `ctx.client.harnessParity`,
 * keeping the CLI off the runner internals.
 */

import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import type { HarnessParityArtifactSummary } from "./client.js";

export type BuildHarnessParityCommandDeps = {
  ctx: ModuleContext;
};

export function buildHarnessParityCommand(
  deps: BuildHarnessParityCommandDeps,
): Command {
  const { ctx } = deps;

  const cmd = new Command("harness-parity").description(
    "Run coding-task scenarios across every registered harness and capture paired artifacts.",
  );

  cmd
    .command("list")
    .description("List available scenarios.")
    .action(async () => {
      const result = await ctx.client.harnessParity.list();
      if (result.scenarios.length === 0) {
        print(line(plain("No scenarios found.")));
        return;
      }
      const rows = result.scenarios.flatMap((s) => [
        line(span(s.id, "accent", true)),
        line(span(`  ${s.description}`, "muted")),
      ]);
      print(stack(...rows));
    });

  cmd
    .command("run")
    .description(
      "Materialize each scenario and run it across every registered harness.",
    )
    .option(
      "--scenario <id>",
      "Run only the scenario with this id (repeatable)",
      (v, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option(
      "--harness <name>",
      "Only run against the named harness (repeatable; defaults to every registered harness)",
      (v, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option(
      "-m, --model <model>",
      "Model passed to each harness (default: claude-sonnet-4-6)",
      "claude-sonnet-4-6",
    )
    .option(
      "--max-turns <n>",
      "Upper turn bound for iterating harnesses (ignored by thin)",
    )
    .option("--out <dir>", "Override output directory for paired artifacts")
    .option("--keep", "Keep materialized working directories for inspection")
    .action(
      async (opts: {
        scenario: string[];
        harness: string[];
        model: string;
        maxTurns?: string;
        out?: string;
        keep?: boolean;
      }) => {
        let maxTurns: number | undefined;
        if (opts.maxTurns !== undefined) {
          const parsed = Number.parseInt(opts.maxTurns, 10);
          if (!Number.isFinite(parsed) || parsed < 1) {
            throw new Error(
              `--max-turns must be a positive integer, got "${opts.maxTurns}".`,
            );
          }
          maxTurns = parsed;
        }

        const result = await ctx.client.harnessParity.run({
          ...(opts.scenario.length > 0 && { scenarios: opts.scenario }),
          ...(opts.harness.length > 0 && { harnesses: opts.harness }),
          model: opts.model,
          ...(maxTurns !== undefined && { maxTurns }),
          ...(opts.out !== undefined && { outDir: opts.out }),
          ...(opts.keep !== undefined && { keepWorkingDir: opts.keep }),
        });

        if (!result.ok) {
          console.error(`harness-parity run failed (${result.reason}): ${result.message}`);
          process.exitCode = 1;
          return;
        }

        const byScenario = groupByScenario(result.artifacts);
        let anyHarnessFailed = false;
        for (const [scenarioId, artifacts] of byScenario) {
          const rows = artifacts.map((a) => {
            const verdictRole = a.passed ? "success" : a.isError ? "error" : "warn";
            return line(
              span(`  ${a.harnessName}`, "accent"),
              plain("  verification="),
              span(a.passed ? "pass" : "fail", verdictRole),
              plain("  turns="),
              span(String(a.turns), "info"),
              plain("  changed="),
              span(String(a.changedFiles.length), "info"),
            );
          });
          print(stack(line(span(scenarioId, "accent", true)), ...rows));
          print(blank());
          for (const a of artifacts) if (!a.passed) anyHarnessFailed = true;
        }

        print(line(span(`artifacts: ${result.outBaseDir}`, "muted")));
        if (anyHarnessFailed) process.exitCode = 1;
      },
    );

  return cmd;
}

function groupByScenario(
  artifacts: HarnessParityArtifactSummary[],
): Map<string, HarnessParityArtifactSummary[]> {
  const out = new Map<string, HarnessParityArtifactSummary[]>();
  for (const artifact of artifacts) {
    const list = out.get(artifact.scenarioId) ?? [];
    list.push(artifact);
    out.set(artifact.scenarioId, list);
  }
  return out;
}

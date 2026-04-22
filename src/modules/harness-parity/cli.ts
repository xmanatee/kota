/**
 * `kota harness-parity` CLI surface.
 *
 * Operators run `kota harness-parity run` to execute scenarios across every
 * registered harness and capture paired artifacts under `.kota/runs/`. The
 * command reuses the same `runAgentHarness` path the main `kota run` entry
 * point uses, so the evidence reflects operator reality rather than a
 * parallel benchmarking framework.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { listAgentHarnessNames, resolveAgentHarness } from "#core/agent-harness/index.js";
import {
  blank,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { runScenarioAcrossHarnesses } from "./runner.js";
import {
  type LoadedScenario,
  loadAllScenarios,
  loadScenario,
  ScenarioLoadError,
} from "./scenario.js";

export type BuildHarnessParityCommandDeps = {
  projectDir: string;
  scenariosRoot: string;
  /** Default base dir for paired artifacts (overridden by `--out`). */
  defaultOutBaseDir: string;
};

function resolveScenarios(
  scenariosRoot: string,
  ids: readonly string[],
): LoadedScenario[] | null {
  try {
    return ids.length > 0
      ? ids.map((id) => loadScenario(scenariosRoot, id))
      : loadAllScenarios(scenariosRoot);
  } catch (err) {
    if (err instanceof ScenarioLoadError) {
      console.error(`harness-parity scenario error: ${err.message}`);
      console.error(`  offending scenario directory: ${err.scenarioDir}`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }
}

function resolveHarnesses(names: readonly string[]): AgentHarness[] {
  const resolved: AgentHarness[] = [];
  const targets = names.length > 0 ? names : listAgentHarnessNames();
  if (targets.length === 0) {
    throw new Error(
      "No agent harnesses are registered; load a harness module (e.g. claude-agent-harness) before running harness-parity.",
    );
  }
  for (const name of targets) resolved.push(resolveAgentHarness(name));
  return resolved;
}

function buildOutBaseDir(defaultOutBaseDir: string, override?: string): string {
  if (override) return override;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(defaultOutBaseDir, `harness-parity-${stamp}`);
}

export function buildHarnessParityCommand(
  deps: BuildHarnessParityCommandDeps,
): Command {
  const { scenariosRoot, defaultOutBaseDir } = deps;

  const cmd = new Command("harness-parity").description(
    "Run coding-task scenarios across every registered harness and capture paired artifacts.",
  );

  cmd
    .command("list")
    .description("List available scenarios.")
    .action(() => {
      const scenarios = resolveScenarios(scenariosRoot, []);
      if (scenarios === null) return;
      if (scenarios.length === 0) {
        print(line(plain("No scenarios found.")));
        return;
      }
      const rows = scenarios.flatMap((s) => [
        line(span(s.spec.id, "accent", true)),
        line(span(`  ${s.spec.description}`, "muted")),
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
        const scenarios = resolveScenarios(scenariosRoot, opts.scenario);
        if (scenarios === null) return;
        if (scenarios.length === 0) {
          console.error(`No scenarios to run under "${scenariosRoot}".`);
          process.exitCode = 1;
          return;
        }
        const harnesses = resolveHarnesses(opts.harness);
        const outBaseDir = buildOutBaseDir(defaultOutBaseDir, opts.out);
        mkdirSync(outBaseDir, { recursive: true });

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

        let anyHarnessFailed = false;
        for (const scenario of scenarios) {
          const artifacts = await runScenarioAcrossHarnesses({
            scenario,
            harnesses,
            callOptions: {
              model: opts.model,
              ...(maxTurns !== undefined ? { maxTurns } : {}),
            },
            outBaseDir,
            ...(opts.keep !== undefined ? { keepWorkingDir: opts.keep } : {}),
          });

          const rows = artifacts.map((a) => {
            const verdictRole = a.verification.passed
              ? "success"
              : a.isError
                ? "error"
                : "warn";
            return line(
              span(`  ${a.harnessName}`, "accent"),
              plain("  verification="),
              span(a.verification.passed ? "pass" : "fail", verdictRole),
              plain("  turns="),
              span(String(a.turns), "info"),
              plain("  changed="),
              span(String(a.changedFiles.length), "info"),
            );
          });
          print(stack(
            line(span(scenario.spec.id, "accent", true)),
            ...rows,
          ));
          print(blank());

          for (const a of artifacts) {
            if (!a.verification.passed) anyHarnessFailed = true;
          }
        }

        print(line(span(`artifacts: ${outBaseDir}`, "muted")));
        if (anyHarnessFailed) process.exitCode = 1;
      },
    );

  return cmd;
}

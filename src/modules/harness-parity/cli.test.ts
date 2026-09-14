import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { buildHarnessParityCommand } from "./cli.js";
import type { HarnessParityMatrixOptions, HarnessParityRunOptions } from "./client.js";

function recordingCommand() {
  const matrixCalls: HarnessParityMatrixOptions[] = [];
  const runCalls: HarnessParityRunOptions[] = [];
  const client = createKotaClientTestDouble({ harnessParity: {
    async matrix(options) {
      matrixCalls.push(options ?? {});
      return {
        ok: true, outBaseDir: "/reports", reportPath: "/reports/matrix.json",
        rows: [], groups: [], shadowComparisons: [],
        aggregate: { groupCount: 0, runnableGroupCount: 0, skippedGroupCount: 0, passAtK: null, passHatK: null },
      };
    },
    async run(options) {
      runCalls.push(options ?? {});
      return { ok: true, outBaseDir: "/reports", artifacts: [] };
    },
  } });
  const command = buildHarnessParityCommand({ ctx: { cwd: "/scope", client } as ModuleContext });
  return { command, matrixCalls, runCalls };
}

afterEach(() => vi.restoreAllMocks());

describe("harness-parity numeric command options", () => {
  // Shared syntax cases live with eval-harness. These cases detect missed
  // migration or incorrect option/domain binding at this command boundary.
  it.each([
    ["matrix", "repeats", "1e3"], ["matrix", "max-turns", "2.9"],
    ["matrix", "cpu-allocation-cores", "2oops"],
    ["matrix", "cpu-kill-threshold-cores", "Infinity"],
    ["matrix", "memory-allocation-mb", "0"],
    ["matrix", "memory-kill-threshold-mb", "-1"],
    ["run", "max-turns", "2.9"],
  ])("rejects %s --%s %s before dispatch", async (subcommand, option, raw) => {
    const { command, matrixCalls, runCalls } = recordingCommand();
    await expect(command.parseAsync([subcommand, `--${option}`, raw], { from: "user" }))
      .rejects.toThrow(`--${option} must be`);
    expect(matrixCalls).toEqual([]);
    expect(runCalls).toEqual([]);
  });

  it("preserves matrix integers and fractional resources exactly", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { command, matrixCalls } = recordingCommand();
    await command.parseAsync([
      "matrix", "--repeats", "+2", "--max-turns", "12",
      "--cpu-allocation-cores", ".25", "--cpu-kill-threshold-cores", "1.5",
      "--memory-allocation-mb", "1024.5", "--memory-kill-threshold-mb", "2048.75",
    ], { from: "user" });
    expect(matrixCalls).toEqual([{
      repeats: 2, maxTurns: 12, cpuAllocationCores: 0.25, cpuKillThresholdCores: 1.5,
      memoryAllocationMB: 1024.5, memoryKillThresholdMB: 2048.75,
    }]);
  });

  it("preserves defaults and absent optional fields, and forwards run max-turns", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const defaults = recordingCommand();
    await defaults.command.parseAsync(["matrix"], { from: "user" });
    expect(defaults.matrixCalls).toEqual([{ repeats: 1 }]);
    const omitted = recordingCommand();
    await omitted.command.parseAsync(["run"], { from: "user" });
    expect(omitted.runCalls).toEqual([{}]);
    const explicit = recordingCommand();
    await explicit.command.parseAsync(["run", "--max-turns", "12"], { from: "user" });
    expect(explicit.runCalls).toEqual([{ maxTurns: 12 }]);
  });
});

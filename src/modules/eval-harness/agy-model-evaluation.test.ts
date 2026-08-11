import { describe, expect, it } from "vitest";
import {
  parseAgyAvailableModels,
  probeAgyModelAvailability,
  runAgyModelsCommand,
  validateAgyEvaluationEffort,
} from "./agy-model-availability.js";
import type { EvalRunExecution } from "./eval-run-execution.js";

const UNUSED_AVAILABILITY_EXECUTION: EvalRunExecution = {
  executor: {
    preflight: () => {
      throw new Error("custom command runner should not preflight");
    },
    execute: async () => {
      throw new Error("custom command runner should not execute a workflow");
    },
  },
  requestedProfile: {
    hostClass: "unused-test-runtime",
    cpuAllocationCores: 1,
    cpuKillThresholdCores: 1,
    memoryAllocationMB: 256,
    memoryKillThresholdMB: 256,
  },
  isolationBackend: { kind: "host-subprocess" },
  executorEnv: {},
};

describe("AGY model availability", () => {
  it("parses and de-duplicates candidate ids from agy models output", () => {
    expect(
      parseAgyAvailableModels(
        "Available models:\n- gemini-3.6-flash-high default\n" +
          "gemini-3.5-pro-high\ngemini-3.6-flash-high\n",
      ),
    ).toEqual(["gemini-3.5-pro-high", "gemini-3.6-flash-high"]);
  });

  it("refuses to fall back to a host model catalog", () => {
    expect(runAgyModelsCommand(UNUSED_AVAILABILITY_EXECUTION)).toMatchObject({
      status: null,
      errorMessage: expect.stringContaining("host execution is forbidden"),
    });
  });

  it("fails visibly when any requested candidate is unavailable", () => {
    const result = probeAgyModelAvailability(
      ["gemini-3.6-flash", "gemini-missing"],
      UNUSED_AVAILABILITY_EXECUTION,
      () => ({
        status: 0,
        stdout: "gemini-3.6-flash-high\n",
        stderr: "",
        runtimeDetail: "test candidate container",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "candidate_unavailable",
      evidence: {
        availableModels: ["gemini-3.6-flash-high"],
        requestedCatalogModels: [
          "gemini-3.6-flash-high",
          "gemini-missing-high",
        ],
        nativeEffort: "high",
        passed: false,
      },
    });
    expect(validateAgyEvaluationEffort("high")).toEqual({
      ok: false,
      message: expect.stringContaining('requires effort "max"'),
    });
  });

  it("requires the effort-qualified catalog entry for a candidate", () => {
    const highAvailable = probeAgyModelAvailability(
      ["gemini-3.6-flash"],
      UNUSED_AVAILABILITY_EXECUTION,
      () => ({
        status: 0,
        stdout: "gemini-3.6-flash-high\n",
        stderr: "",
        runtimeDetail: "test candidate container",
      }),
    );
    expect(highAvailable).toMatchObject({
      ok: true,
      evidence: {
        requestedModels: ["gemini-3.6-flash"],
        requestedCatalogModels: ["gemini-3.6-flash-high"],
        nativeEffort: "high",
        passed: true,
      },
    });

    const baseOnly = probeAgyModelAvailability(
      ["gemini-3.6-flash"],
      UNUSED_AVAILABILITY_EXECUTION,
      () => ({
        status: 0,
        stdout: "gemini-3.6-flash\n",
        stderr: "",
        runtimeDetail: "test candidate container",
      }),
    );
    expect(baseOnly).toMatchObject({
      ok: false,
      reason: "candidate_unavailable",
      evidence: {
        requestedCatalogModels: ["gemini-3.6-flash-high"],
        passed: false,
      },
    });
  });
});

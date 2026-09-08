import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import { makeRunRecordingCtx } from "./cli-test-support.js";
import type { EvalCalibrationOptions } from "./client.js";
import { SAMPLE_CALIBRATION_RESULT } from "./daemon-client-test-support.js";

const originalExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); process.exitCode = originalExitCode; });

describe("eval calibration CLI", () => {
  it("forwards calibration options and renders the returned gate", async () => {
    process.exitCode = 0;
    const ctx = makeRunRecordingCtx([]);
    const calls: EvalCalibrationOptions[] = [];
    ctx.client.evalHarness.calibration = async (options) => {
      calls.push(options ?? {});
      return SAMPLE_CALIBRATION_RESULT;
    };
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => { chunks.push(String(data)); return true; });
    await buildEvalCommand(ctx).parseAsync([
      "calibration", "--window-days", "5", "--min-sample", "2", "--json",
    ], { from: "user" });
    expect(calls).toEqual([expect.objectContaining({ windowDays: 5, minSample: 2 })]);
    expect(JSON.parse(chunks.join(""))).toEqual(SAMPLE_CALIBRATION_RESULT);
    expect(process.exitCode).toBe(SAMPLE_CALIBRATION_RESULT.decision.status === "gated" ? 2 : 0);
  });
});

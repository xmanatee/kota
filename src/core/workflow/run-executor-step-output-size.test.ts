import { describe, expect, it } from "vitest";
import {
  applyOutputSizeLimit,
  DEFAULT_MAX_STEP_OUTPUT_BYTES,
  HARD_MAX_STEP_OUTPUT_BYTES,
} from "./run-executor-step.js";

describe("applyOutputSizeLimit", () => {
  it("returns output unchanged when below the default limit", () => {
    const output = { data: "small" };
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toEqual(output);
    expect(result.warning).toBeUndefined();
  });

  it("returns output unchanged when exactly at the limit", () => {
    const str = "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES - 2);
    const output = str;
    const serialized = JSON.stringify(output);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThanOrEqual(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toEqual(output);
    expect(result.warning).toBeUndefined();
  });

  it("truncates output exceeding the default limit with a structured notice", () => {
    const largeOutput = { data: "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES) };
    const result = applyOutputSizeLimit(largeOutput, undefined);
    expect(result.output).toMatchObject({
      truncated: true,
      originalBytes: expect.any(Number),
      message: expect.stringContaining("truncated"),
    });
    expect((result.output as { originalBytes: number }).originalBytes).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(result.warning).toBeDefined();
    expect(result.warning?.type).toBe("step-output-truncated");
  });

  it("respects a custom maxBytes limit", () => {
    const output = { value: "hello world" };
    const serialized = JSON.stringify(output);
    const byteLen = Buffer.byteLength(serialized, "utf-8");
    const result = applyOutputSizeLimit(output, byteLen - 1);
    expect(result.output).toMatchObject({ truncated: true, originalBytes: byteLen });
    expect(result.warning).toBeDefined();
  });

  it("enforces the hard cap even when maxBytes is set higher", () => {
    const overLimit = HARD_MAX_STEP_OUTPUT_BYTES + 1;
    const result = applyOutputSizeLimit({ data: "x".repeat(overLimit) }, overLimit * 2);
    expect(result.output).toMatchObject({ truncated: true });
    expect(result.warning).toBeDefined();
  });

  it("passes through undefined and null without truncation", () => {
    expect(applyOutputSizeLimit(undefined, undefined)).toEqual({ output: undefined });
    expect(applyOutputSizeLimit(null, undefined)).toEqual({ output: null });
  });

  it("includes the original byte count in the truncation notice", () => {
    const output = "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES + 100);
    const result = applyOutputSizeLimit(output, undefined);
    expect((result.output as { originalBytes: number }).originalBytes).toBe(
      Buffer.byteLength(JSON.stringify(output), "utf-8"),
    );
  });

  it("replaces non-serializable output with a structured warning notice", () => {
    const output: Record<string, unknown> = {};
    output.self = output;
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toMatchObject({
      truncated: true,
      originalBytes: 0,
      message: expect.stringContaining("could not be serialized"),
    });
    expect(result.warning).toMatchObject({
      type: "step-output-truncated",
      message: expect.stringContaining("could not be serialized"),
    });
  });
});

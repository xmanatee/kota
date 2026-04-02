import { describe, expect, it } from "vitest";
import { extractRepairSummary } from "../workflow/run-store-helpers.js";
import { formatRepairLine, formatWarningsSection } from "./run-show.js";

// ---------------------------------------------------------------------------
// formatWarningsSection
// ---------------------------------------------------------------------------

describe("formatWarningsSection", () => {
  it("formats a single warning", () => {
    const lines = formatWarningsSection([{ type: "output-schema-mismatch", message: "Expected string, got number at $.count" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("  [output-schema-mismatch] Expected string, got number at $.count");
  });

  it("formats multiple warnings", () => {
    const lines = formatWarningsSection([
      { type: "output-schema-mismatch", message: "first warning" },
      { type: "other-warning", message: "second warning" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[output-schema-mismatch]");
    expect(lines[1]).toContain("[other-warning]");
  });

  it("returns empty array for no warnings", () => {
    expect(formatWarningsSection([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractRepairSummary
// ---------------------------------------------------------------------------

describe("extractRepairSummary", () => {
  it("returns null for null output", () => {
    expect(extractRepairSummary(null)).toBeNull();
  });

  it("returns null when repairIterations is absent", () => {
    expect(extractRepairSummary({ totalCostUsd: 0.05 })).toBeNull();
  });

  it("returns null when repairIterations is empty", () => {
    expect(extractRepairSummary({ repairIterations: [] })).toBeNull();
  });

  it("returns summary for a single repair iteration", () => {
    const output = {
      totalCostUsd: 0.03,
      repairIterations: [
        {
          attempt: 1,
          failures: [{ id: "check-lint", passed: false, output: "lint error" }],
          agentCostUsd: 0.02,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.attempts).toBe(1);
    expect(summary!.failedChecksByAttempt).toEqual([["check-lint"]]);
    expect(summary!.totalCostUsd).toBeCloseTo(0.02);
  });

  it("returns summary for multiple repair iterations", () => {
    const output = {
      totalCostUsd: 0.06,
      repairIterations: [
        {
          attempt: 1,
          failures: [
            { id: "check-lint", passed: false, output: "lint error" },
            { id: "check-typecheck", passed: false, output: "type error" },
          ],
          agentCostUsd: 0.01,
        },
        {
          attempt: 2,
          failures: [{ id: "check-lint", passed: false, output: "lint error" }],
          agentCostUsd: 0.02,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.attempts).toBe(2);
    expect(summary!.failedChecksByAttempt).toEqual([
      ["check-lint", "check-typecheck"],
      ["check-lint"],
    ]);
    expect(summary!.totalCostUsd).toBeCloseTo(0.03);
  });

  it("handles iteration with no failures (all passed in last repair)", () => {
    const output = {
      repairIterations: [
        {
          attempt: 1,
          failures: [],
          agentCostUsd: 0.01,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.failedChecksByAttempt).toEqual([[]]);
  });

  it("sums repair cost across iterations", () => {
    const output = {
      repairIterations: [
        { attempt: 1, failures: [], agentCostUsd: 0.01 },
        { attempt: 2, failures: [], agentCostUsd: 0.03 },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary!.totalCostUsd).toBeCloseTo(0.04);
  });
});

// ---------------------------------------------------------------------------
// formatRepairLine
// ---------------------------------------------------------------------------

describe("formatRepairLine", () => {
  it("formats a single repair", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [["check-lint"]],
      totalCostUsd: 0.01,
    });
    expect(line).toContain("1 repair");
    expect(line).toContain("$0.010");
    expect(line).toContain("[1] check-lint");
  });

  it("formats multiple repairs", () => {
    const line = formatRepairLine({
      attempts: 2,
      failedChecksByAttempt: [["check-lint", "check-typecheck"], ["check-lint"]],
      totalCostUsd: 0.03,
    });
    expect(line).toContain("2 repairs");
    expect(line).toContain("[1] check-lint, check-typecheck");
    expect(line).toContain("[2] check-lint");
  });

  it("omits cost when zero", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [["check-lint"]],
      totalCostUsd: 0,
    });
    expect(line).not.toContain("$");
    expect(line).toContain("1 repair");
  });

  it("shows 'passed' when iteration had no failures", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [[]],
      totalCostUsd: 0.01,
    });
    expect(line).toContain("[1] passed");
  });
});

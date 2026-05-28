import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodeHealthDiagnosticsValidationError,
  type CodeHealthThresholds,
  evaluateCodeHealthRound,
  measureCodeHealth,
  parseCodeHealthDiagnosticsConfig,
} from "./code-health-diagnostics.js";

describe("code-health diagnostics", () => {
  let workingDir: string;

  beforeEach(() => {
    workingDir = mkdtempSync(join(tmpdir(), "kota-code-health-"));
    mkdirSync(join(workingDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
  });

  function config(
    overrides: {
      excludeGlobs?: string[];
      thresholds?: Partial<CodeHealthThresholds>;
    } = {},
  ) {
    const parsed = parseCodeHealthDiagnosticsConfig(
      {
        sourceGlobs: ["src/**/*.ts"],
        thresholds: {
          minSourceGrowthBytes: 1,
          maxBaselineBytesGrowthRatio: 1.2,
          maxPreviousBytesGrowthRatio: 1.2,
          duplicateChunkLines: 3,
          duplicateChunkMinOccurrences: 2,
          maxLargestFileBytesShare: 0.95,
          maxLargestFunctionLines: 20,
          ...overrides.thresholds,
        },
        ...(overrides.excludeGlobs !== undefined && {
          excludeGlobs: overrides.excludeGlobs,
        }),
      },
      workingDir,
    );
    if (parsed === undefined) throw new Error("expected config");
    return parsed;
  }

  it("records clean measurements without warnings", () => {
    writeFileSync(
      join(workingDir, "src", "app.ts"),
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    );
    const diagnosticsConfig = config();
    const baseline = measureCodeHealth(workingDir, diagnosticsConfig);
    const round = evaluateCodeHealthRound({
      config: diagnosticsConfig,
      workingDir,
      baseline,
      previous: baseline,
      roundId: "round-1",
      roundIndex: 0,
      outcome: "pass",
    });

    expect(round.measurement.fileCount).toBe(1);
    expect(round.measurement.totalBytes).toBeGreaterThan(0);
    expect(round.measurement.largestFunction).toMatchObject({
      path: "src/app.ts",
      name: "add",
    });
    expect(round.warnings).toEqual([]);
    expect(round.warningCounts).toEqual({
      "source-size-growth": 0,
      "duplicated-implementation-chunk": 0,
      "complexity-concentration": 0,
    });
  });

  it("warns when source size grows beyond baseline or previous round thresholds", () => {
    writeFileSync(join(workingDir, "src", "app.ts"), "export const a = 1;\n");
    const diagnosticsConfig = config();
    const baseline = measureCodeHealth(workingDir, diagnosticsConfig);
    writeFileSync(
      join(workingDir, "src", "app.ts"),
      "export const a = 1;\nexport const padding = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';\n",
    );

    const round = evaluateCodeHealthRound({
      config: diagnosticsConfig,
      workingDir,
      baseline,
      previous: baseline,
      roundId: "round-1",
      roundIndex: 0,
      outcome: "pass",
    });

    expect(round.warnings.map((warning) => warning.code)).toContain(
      "source-size-growth",
    );
    expect(round.warningCounts["source-size-growth"]).toBe(1);
  });

  it("warns on duplicated implementation chunks", () => {
    const duplicate = [
      "export function one() {",
      "  const value = 1;",
      "  return value;",
      "}",
    ].join("\n");
    writeFileSync(join(workingDir, "src", "a.ts"), `${duplicate}\n`);
    writeFileSync(join(workingDir, "src", "b.ts"), `${duplicate}\n`);
    const diagnosticsConfig = config();
    const baseline = measureCodeHealth(workingDir, diagnosticsConfig);
    const round = evaluateCodeHealthRound({
      config: diagnosticsConfig,
      workingDir,
      baseline,
      previous: baseline,
      roundId: "round-1",
      roundIndex: 0,
      outcome: "pass",
    });

    const warning = round.warnings.find(
      (entry) => entry.code === "duplicated-implementation-chunk",
    );
    expect(warning).toMatchObject({
      code: "duplicated-implementation-chunk",
      duplicatedChunkCount: expect.any(Number),
      duplicatedOccurrenceCount: expect.any(Number),
    });
    expect(round.warningCounts["duplicated-implementation-chunk"]).toBe(1);
  });

  it("warns on complexity concentration in a large function", () => {
    writeFileSync(
      join(workingDir, "src", "app.ts"),
      [
        "export function tooLarge() {",
        "  const a = 1;",
        "  const b = 2;",
        "  const c = 3;",
        "  const d = 4;",
        "  return a + b + c + d;",
        "}",
      ].join("\n"),
    );
    const diagnosticsConfig = config({
      thresholds: {
        minSourceGrowthBytes: 1,
        maxBaselineBytesGrowthRatio: 2,
        maxPreviousBytesGrowthRatio: 2,
        duplicateChunkLines: 3,
        duplicateChunkMinOccurrences: 2,
        maxLargestFileBytesShare: 1,
        maxLargestFunctionLines: 3,
      },
    });
    const baseline = measureCodeHealth(workingDir, diagnosticsConfig);
    const round = evaluateCodeHealthRound({
      config: diagnosticsConfig,
      workingDir,
      baseline,
      previous: baseline,
      roundId: "round-1",
      roundIndex: 0,
      outcome: "pass",
    });

    expect(round.warnings).toContainEqual(
      expect.objectContaining({
        code: "complexity-concentration",
        signals: [
          expect.objectContaining({
            kind: "largest-function",
            name: "tooLarge",
          }),
        ],
      }),
    );
  });

  it("honors excluded globs when measuring and warning", () => {
    mkdirSync(join(workingDir, "src", "generated"), { recursive: true });
    writeFileSync(join(workingDir, "src", "app.ts"), "export const ok = 1;\n");
    const generated = [
      "export function generated() {",
      "  const value = 1;",
      "  return value;",
      "}",
    ].join("\n");
    writeFileSync(join(workingDir, "src", "generated", "a.ts"), generated);
    writeFileSync(join(workingDir, "src", "generated", "b.ts"), generated);
    const diagnosticsConfig = config({
      excludeGlobs: ["src/generated/**"],
    });
    const baseline = measureCodeHealth(workingDir, diagnosticsConfig);
    const round = evaluateCodeHealthRound({
      config: diagnosticsConfig,
      workingDir,
      baseline,
      previous: baseline,
      roundId: "round-1",
      roundIndex: 0,
      outcome: "pass",
    });

    expect(round.measurement.files.map((file) => file.path)).toEqual([
      "src/app.ts",
    ]);
    expect(round.warnings).toEqual([]);
  });

  it("rejects malformed diagnostic configuration", () => {
    let caught: unknown;
    try {
      parseCodeHealthDiagnosticsConfig(
        {
          sourceGlobs: ["../escape.ts"],
        },
        workingDir,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodeHealthDiagnosticsValidationError);
    expect((caught as CodeHealthDiagnosticsValidationError).reason).toBe(
      "malformed-declaration",
    );
  });
});

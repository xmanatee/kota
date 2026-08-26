import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import {
  makeFakeCtx,
  seedCalibration,
} from "./cli-test-support.js";

async function captureStdout(fn: () => Promise<object | void>): Promise<string> {
  const chunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    stdoutSpy.mockRestore();
  }
  return chunks.join("");
}

describe("kota eval calibration CLI", () => {
  let workspaceRoot: string;
  let runsDir: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "cal-cli-"));
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("aggregates seeded artifacts and prints human-readable summary", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(workspaceRoot));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "1", "--threshold-rate", "0.9"],
      { from: "user" },
    );

    const text = logs.join("\n");
    expect(text).toContain("evaluator calibration");
    expect(text).toContain("total runs=2");
    expect(text).toContain("pass=1");
    expect(text).toContain("pass contradiction: 1/1");
  });

  it("sets exitCode=2 and emits JSON when gated", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const cmd = buildEvalCommand(makeFakeCtx(workspaceRoot));
    const output = await captureStdout(() => cmd.parseAsync(
      [
        "calibration",
        "--min-sample",
        "1",
        "--threshold-rate",
        "0.25",
        "--json",
      ],
      { from: "user" },
    ));

    expect(process.exitCode).toBe(2);
    const parsed = JSON.parse(output) as {
      aggregate: { passContradictionCount: number };
      decision: { status: string };
    };
    expect(parsed.aggregate.passContradictionCount).toBe(1);
    expect(parsed.decision.status).toBe("gated");
  });

  it("reports insufficient-sample when fewer pass verdicts than minSample", async () => {
    const nowIso = new Date().toISOString();
    seedCalibration(runsDir, "run-a", nowIso, "pass", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(workspaceRoot));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "8", "--threshold-rate", "0.25"],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("insufficient-sample");
  });
});

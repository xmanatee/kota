import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
} from "#modules/autonomy/observability-obligation.js";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import {
  SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
  SOURCE_FILE_SIZE_SEVERE_TYPE,
} from "#modules/autonomy/source-size-escalation.js";
import { SOURCE_FILE_SIZE_REVIEW_ARTIFACT } from "#modules/autonomy/source-size-review-artifact.js";
import { builderRepairChecks } from "./repair-checks.js";

function lines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `export const value${i} = ${i};`).join("\n")}\n`;
}

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

describe("builder source-size repair checks", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-builder-source-size-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(repoDir, "src"), { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("wires severe source-size batches as blocking while preserving advisory warning artifacts", async () => {
    for (let i = 0; i < SOURCE_FILE_SEVERE_BATCH_THRESHOLD; i += 1) {
      writeFileSync(join(repoDir, "src", `large-${i}.ts`), lines(301));
    }
    execSync("git add src", { cwd: repoDir });
    const runDir = join(repoDir, ".kota", "runs", "test-run");
    mkdirSync(runDir, { recursive: true });
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
    const severe = checks.get(SOURCE_FILE_SIZE_SEVERE_TYPE);
    const advisory = checks.get(SOURCE_FILE_SIZE_WARNING_TYPE);
    const ctx = {
      projectDir: repoDir,
      workflow: { runDirPath: runDir },
    } as WorkflowStepContext;

    expect(severe).toMatchObject({
      id: SOURCE_FILE_SIZE_SEVERE_TYPE,
      type: "code",
      phase: 1,
    });
    expect(advisory).toMatchObject({
      id: SOURCE_FILE_SIZE_WARNING_TYPE,
      type: "code",
      severity: "warning",
      phase: 1,
    });
    if (!severe || severe.type !== "code") throw new Error("missing severe source-size check");
    if (!advisory || advisory.type !== "code") throw new Error("missing advisory source-size check");

    expect(() => severe.run(ctx, {} as never)).toThrow(/Blocking severe source-size failure/);
    expect(JSON.parse(readFileSync(join(runDir, SOURCE_FILE_SIZE_REVIEW_ARTIFACT), "utf-8")))
      .toMatchObject({
        outcome: "blocking",
        reasons: expect.arrayContaining([
          expect.objectContaining({
            kind: "oversized-batch",
          }),
        ]),
      });
    expect(() => advisory.run(ctx, {} as never)).toThrow(SOURCE_FILE_SIZE_WARNING_TYPE);
  });

  it("wires observability obligation diagnostics as advisory run artifacts", async () => {
    const workflowDir = join(repoDir, "src", "core", "workflow");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "retry.ts"),
      [
        "export async function runStep(step: { run(): Promise<void> }) {",
        "  try {",
        "    return await step.run();",
        "  } catch (error) {",
        "    return null;",
        "  }",
        "}",
      ].join("\n"),
    );
    execSync("git add src/core/workflow/retry.ts", { cwd: repoDir });
    const runDir = join(repoDir, ".kota", "runs", "test-run-observability");
    mkdirSync(runDir, { recursive: true });
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
    const observability = checks.get(OBSERVABILITY_OBLIGATION_WARNING_TYPE);
    const ctx = {
      projectDir: repoDir,
      workflow: { runDirPath: runDir },
    } as WorkflowStepContext;

    expect(observability).toMatchObject({
      id: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      type: "code",
      severity: "warning",
      phase: 1,
    });
    if (!observability || observability.type !== "code") {
      throw new Error("missing observability obligation check");
    }

    expect(() => observability.run(ctx, {} as never)).toThrow(
      OBSERVABILITY_OBLIGATION_WARNING_TYPE,
    );
    expect(JSON.parse(readFileSync(join(runDir, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT), "utf-8")))
      .toMatchObject({
        outcome: "warning",
        missingFiles: ["src/core/workflow/retry.ts"],
      });
  });
});

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkObservabilityObligationsForRun,
  detectObservabilityObligationReview,
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
} from "./observability-obligation.js";

function diffFor(
  file: string,
  addedLines: readonly string[],
  deletedLines: readonly string[] = [],
): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 0000001..0000002 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${Math.max(deletedLines.length, 1)} +1,${Math.max(addedLines.length, 1)} @@`,
    ...deletedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

describe("observability obligation diagnostic", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(
      tmpdir(),
      `kota-observability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("flags runtime error and retry changes without observable evidence", () => {
    const review = detectObservabilityObligationReview(
      diffFor("src/core/workflow/retry.ts", [
        "export async function retryStep(step: Step, token: string) {",
        "  try {",
        "    return await step.run(token);",
        "  } catch (error) {",
        "    const retry = { attempted: true };",
        "    void retry;",
        "    const hidden = `VERY_SECRET_${token}`;",
        "    void hidden;",
        "    return null;",
        "  }",
        "}",
      ]),
    );

    expect(review.outcome).toBe("warning");
    expect(review.missingFiles).toEqual(["src/core/workflow/retry.ts"]);
    expect(review.candidates[0]).toMatchObject({
      file: "src/core/workflow/retry.ts",
      status: "missing",
      evidence: [],
    });
    expect(review.candidates[0]?.reasons.map((reason) => reason.kind)).toEqual(
      expect.arrayContaining(["error-handling", "retry-recovery"]),
    );
    expect(review.followUpTask).toMatchObject({
      candidateFiles: ["src/core/workflow/retry.ts"],
      artifact: OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
    });
    expect(JSON.stringify(review)).not.toContain("VERY_SECRET");
  });

  it("accepts the same runtime shape when structured logging evidence is added", () => {
    const review = detectObservabilityObligationReview(
      diffFor("src/core/workflow/retry.ts", [
        "export async function retryStep(step: Step, ctx: Ctx) {",
        "  try {",
        "    return await step.run();",
        "  } catch (error) {",
        "    const retry = { attempted: true };",
        "    void retry;",
        "    ctx.log.warn(\"workflow step retry failed\", { stepId: step.id, error: formatError(error) });",
        "    return null;",
        "  }",
        "}",
      ]),
    );

    expect(review.outcome).toBe("ok");
    expect(review.satisfiedFiles).toEqual(["src/core/workflow/retry.ts"]);
    expect(review.candidates[0]?.evidence).toEqual([
      expect.objectContaining({ kind: "structured-log" }),
    ]);
  });

  it("accepts a runtime change with a focused test assertion over observable metadata", () => {
    const review = detectObservabilityObligationReview(
      [
        diffFor("src/core/workflow/retry.ts", [
          "export async function retryStep(step: Step) {",
          "  try {",
          "    return await step.run();",
          "  } catch (error) {",
          "    return null;",
          "  }",
          "}",
        ]),
        diffFor("src/core/workflow/retry.test.ts", [
          "it(\"records retry failure metadata\", () => {",
          "  const result = runScenario();",
          "  expect(result.metadata.warnings).toContainEqual({ type: \"retry\", message: \"failure\" });",
          "});",
        ]),
      ].join("\n"),
    );

    expect(review.outcome).toBe("ok");
    expect(review.candidates[0]?.evidence).toEqual([
      expect.objectContaining({
        kind: "focused-test-assertion",
        ref: "src/core/workflow/retry.test.ts",
      }),
    ]);
  });

  it("ignores test-only and task-only changes", () => {
    const review = detectObservabilityObligationReview(
      [
        diffFor("src/core/workflow/retry.test.ts", [
          "it(\"checks warnings\", () => {",
          "  expect(result.metadata.warnings).toEqual([]);",
          "});",
        ]),
        diffFor("src/modules/autonomy/workflows/security-review/workflow-scan.test-cases.ts", [
          "fixture.writeProjectFile(\"src/modules/web-access/fetch.ts\", \"await fetch(url);\");",
          "expect(result.dueTargets.diagnostics).toEqual([]);",
        ]),
        diffFor("data/tasks/ready/task-example.md", [
          "---",
          "id: task-example",
          "status: ready",
          "---",
        ]),
      ].join("\n"),
    );

    expect(review.outcome).toBe("ok");
    expect(review.candidates).toEqual([]);
  });

  it("writes a redacted run artifact from the staged-diff check", () => {
    initRepo(repoDir);
    const srcDir = join(repoDir, "src", "core", "workflow");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "retry.ts"),
      [
        "export async function retryStep(step: { run(): Promise<void> }, token: string) {",
        "  try {",
        "    return await step.run();",
        "  } catch (error) {",
        "    const hidden = `VERY_SECRET_${token}`;",
        "    void hidden;",
        "    return null;",
        "  }",
        "}",
      ].join("\n"),
    );
    execSync("git add src/core/workflow/retry.ts", { cwd: repoDir });
    const runDir = join(repoDir, ".kota", "runs", "test-run");
    mkdirSync(runDir, { recursive: true });

    expect(() => checkObservabilityObligationsForRun(repoDir, runDir)).toThrow(
      OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
    );

    const artifact = JSON.parse(
      readFileSync(join(runDir, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT), "utf-8"),
    );
    expect(artifact).toMatchObject({
      outcome: "warning",
      missingFiles: ["src/core/workflow/retry.ts"],
    });
    expect(JSON.stringify(artifact)).not.toContain("VERY_SECRET");
  });
});

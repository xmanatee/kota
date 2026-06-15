import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRepoHygiene, detectRepoHygieneInDiff } from "./hygiene-check.js";

const HARD_ERROR_DIFF = `diff --git a/src/sample.ts b/src/sample.ts
index 0000001..0000002 100644
--- a/src/sample.ts
+++ b/src/sample.ts
@@ -1,2 +1,8 @@
 export function sample() {}
+try {
+  run();
+} catch {}
+// @ts-expect-error
+// const oldValue = computeOldValue();
`;

const ADVISORY_DIFF = `diff --git a/src/sample.ts b/src/sample.ts
index 0000001..0000002 100644
--- a/src/sample.ts
+++ b/src/sample.ts
@@ -1,2 +1,7 @@
 export function sample() {}
+// Temporary fallback while remote provider is unavailable.
+// Ignore cleanup failure because the cache is already optional.
+// Returns the current status.
`;

const CLEAN_DIFF = `diff --git a/src/sample.ts b/src/sample.ts
index 0000001..0000002 100644
--- a/src/sample.ts
+++ b/src/sample.ts
@@ -1,2 +1,5 @@
 export function sample() {}
+const value = parseSample(input);
+logger.warn(\`cleanup failed: \${message}\`);
+// biome-ignore lint/suspicious/noConsole: JSON output is consumed by shell scripts.
`;

describe("detectRepoHygieneInDiff", () => {
  it("marks only objective mechanical issues as errors", () => {
    const findings = detectRepoHygieneInDiff(HARD_ERROR_DIFF);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "empty-catch",
      "unexplained-suppression",
      "commented-out-code",
    ]);
    expect(findings.every((finding) => finding.severity === "error")).toBe(true);
  });

  it("keeps judgment-heavy wording advisory", () => {
    const findings = detectRepoHygieneInDiff(ADVISORY_DIFF);
    expect(findings.map((finding) => finding.severity)).toEqual([
      "advisory",
      "advisory",
      "advisory",
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "transitional-wording",
      "silent-failure-wording",
      "obvious-comment",
    ]);
  });

  it("allows explicit code and justified lint suppressions", () => {
    expect(detectRepoHygieneInDiff(CLEAN_DIFF)).toEqual([]);
  });

  it("does not treat quoted fixture text as executable code", () => {
    const diff = `diff --git a/src/sample.test.ts b/src/sample.test.ts
index 0000001..0000002 100644
--- a/src/sample.test.ts
+++ b/src/sample.test.ts
@@ -1,2 +1,3 @@
 import { expect, it } from "vitest";
+const fixture = "try { run(); } catch {}";
`;
    expect(detectRepoHygieneInDiff(diff)).toEqual([]);
  });
});

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

describe("checkRepoHygiene", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-hygiene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(repoDir, { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("passes when nothing is staged", () => {
    expect(checkRepoHygiene(repoDir)).toContain("no staged");
  });

  it("rejects staged hard hygiene failures", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/sample.ts"), "try { run(); } catch {}\n");
    execSync("git add src/sample.ts", { cwd: repoDir });
    expect(() => checkRepoHygiene(repoDir)).toThrow(/empty catch/i);
  });

  it("reports advisories without failing", () => {
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src/sample.ts"), "// Temporary fallback.\n");
    execSync("git add src/sample.ts", { cwd: repoDir });
    expect(checkRepoHygiene(repoDir)).toContain("advisory");
  });
});

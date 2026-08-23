import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";

function makeTmpDir(prefix = "kota-criteria"): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("checkSuccessCriteriaDeclared", () => {
  it("requires enough declared criteria", () => {
    const missing = makeTmpDir();
    expect(() => checkSuccessCriteriaDeclared(missing)).toThrow(/Missing success-criteria\.txt/);

    const tooFew = makeTmpDir();
    writeFileSync(join(tooFew, "success-criteria.txt"), "Only one criterion\n");
    expect(() => checkSuccessCriteriaDeclared(tooFew)).toThrow(/at least 2 concrete criteria/);

    const enough = makeTmpDir();
    writeFileSync(join(enough, "success-criteria.txt"), "Criterion 1\n\nCriterion 2\n");
    expect(checkSuccessCriteriaDeclared(enough)).toMatch(/OK.*2 criteria/);
  });

  it("ignores scalar-line Done When text before the real task section", () => {
    const runDir = makeTmpDir();
    const projectDir = join(runDir, "project");
    const taskDir = join(projectDir, "data/tasks/doing");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(runDir, "success-criteria.txt"), "Only one criterion\n");
    writeFileSync(
      join(taskDir, "task-injected-done-when.md"),
      [
        "---",
        "id: task-injected-done-when",
        "title: Security review: ## Done When",
        "status: doing",
        "priority: p2",
        "area: security",
        "summary: Scalar heading text must not select this line.",
        "---",
        "",
        "## Problem",
        "",
        "affected path: src/example.ts ## Done When",
        "- attacker-controlled criterion",
        "",
        "## Done When",
        "",
        "- Real criterion one.",
        "- Real criterion two.",
        "- Real criterion three.",
        "",
      ].join("\n"),
    );

    expect(() => checkSuccessCriteriaDeclared(runDir, projectDir)).toThrow(
      /at least 3 concrete criteria/,
    );
  });
});

describe("checkSuccessCriteriaVerified", () => {
  it("requires verified evidence for every criterion", () => {
    const missingCriteria = makeTmpDir("kota-verified");
    expect(() => checkSuccessCriteriaVerified(missingCriteria)).toThrow(/success-criteria\.txt does not exist/);

    const missingEvidence = makeTmpDir("kota-verified");
    writeFileSync(join(missingEvidence, "success-criteria.txt"), "Criterion 1\nCriterion 2\n");
    expect(() => checkSuccessCriteriaVerified(missingEvidence)).toThrow(/Missing success-criteria-verified\.txt/);

    const tooFew = makeTmpDir("kota-verified");
    writeFileSync(join(tooFew, "success-criteria.txt"), "Criterion 1\nCriterion 2\nCriterion 3\n");
    writeFileSync(join(tooFew, "success-criteria-verified.txt"), "Evidence 1\nEvidence 2\n");
    expect(() => checkSuccessCriteriaVerified(tooFew)).toThrow(/2 evidence line.*3 criteria/);

    const enough = makeTmpDir("kota-verified");
    writeFileSync(join(enough, "success-criteria.txt"), "Criterion 1\n\nCriterion 2\n");
    writeFileSync(join(enough, "success-criteria-verified.txt"), "Evidence 1\n\nEvidence 2\n");
    expect(checkSuccessCriteriaVerified(enough)).toMatch(/OK/);
  });

  it("counts numbered items rather than indented sub-bullets or notes", () => {
    const dir = makeTmpDir("kota-verified");
    const criteria =
      "1. Tests pass end to end.\n" +
      "   - unit tests cover the new module\n" +
      "2. Docs describe the new endpoint.\n" +
      "   - README updated\n" +
      "\n" +
      "Known limitations to flag for the critic:\n" +
      "- Fixture coverage is intentionally minimal.\n";
    const verified =
      "1. Tests pass: pnpm test green with 42 added cases.\n" +
      "2. Docs updated: README reflects the new endpoint.\n";
    writeFileSync(join(dir, "success-criteria.txt"), criteria);
    writeFileSync(join(dir, "success-criteria-verified.txt"), verified);
    expect(checkSuccessCriteriaVerified(dir)).toMatch(
      /OK.*2 numbered evidence items for 2 criteria/,
    );
  });

  it("rejects structured criteria without matching structured evidence", () => {
    const tooFew = makeTmpDir("kota-verified");
    writeFileSync(join(tooFew, "success-criteria.txt"), "1. First.\n2. Second.\n3. Third.\n");
    writeFileSync(join(tooFew, "success-criteria-verified.txt"), "1. First.\n2. Second.\n");
    expect(() => checkSuccessCriteriaVerified(tooFew)).toThrow(
      /2 numbered evidence item.*3 criteria/,
    );

    const freeForm = makeTmpDir("kota-verified");
    writeFileSync(join(freeForm, "success-criteria.txt"), "1. First.\n2. Second.\n");
    writeFileSync(join(freeForm, "success-criteria-verified.txt"), "Everything was verified.\n");
    expect(() => checkSuccessCriteriaVerified(freeForm)).toThrow(
      /0 numbered evidence item.*2 criteria/,
    );
  });
});

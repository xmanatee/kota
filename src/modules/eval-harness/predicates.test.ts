import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluatePredicate, evaluatePredicates } from "./predicates.js";

describe("evaluatePredicate", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-predicates-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("file-exists passes when the file is present and fails when it is missing", () => {
    writeFileSync(join(workDir, "present.txt"), "hi");
    const ok = evaluatePredicate(workDir, { kind: "file-exists", path: "present.txt" });
    const missing = evaluatePredicate(workDir, { kind: "file-exists", path: "absent.txt" });
    expect(ok.passed).toBe(true);
    expect(missing.passed).toBe(false);
  });

  it("file-absent inverts file-exists", () => {
    writeFileSync(join(workDir, "present.txt"), "hi");
    const ok = evaluatePredicate(workDir, { kind: "file-absent", path: "absent.txt" });
    const bad = evaluatePredicate(workDir, { kind: "file-absent", path: "present.txt" });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("file-contains checks substring presence and handles missing files as failures", () => {
    writeFileSync(join(workDir, "sample.txt"), "hello world");
    const ok = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sample.txt",
      needle: "world",
    });
    const missingNeedle = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sample.txt",
      needle: "nope",
    });
    const missingFile = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "absent.txt",
      needle: "anything",
    });
    expect(ok.passed).toBe(true);
    expect(missingNeedle.passed).toBe(false);
    expect(missingFile.passed).toBe(false);
    expect(missingFile.detail).toContain("file missing");
  });

  it("shell-succeeds passes on exit 0 and fails on non-zero", () => {
    const ok = evaluatePredicate(workDir, {
      kind: "shell-succeeds",
      command: "true",
    });
    const bad = evaluatePredicate(workDir, {
      kind: "shell-succeeds",
      command: "false",
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("shell-fails inverts shell-succeeds", () => {
    const ok = evaluatePredicate(workDir, {
      kind: "shell-fails",
      command: "false",
    });
    const bad = evaluatePredicate(workDir, {
      kind: "shell-fails",
      command: "true",
    });
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("evaluatePredicates passes only when every predicate passes", () => {
    writeFileSync(join(workDir, "file.txt"), "content");
    const { passed, results } = evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-contains", path: "file.txt", needle: "cont" },
    ]);
    expect(passed).toBe(true);
    expect(results).toHaveLength(2);

    const mixed = evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-exists", path: "missing.txt" },
    ]);
    expect(mixed.passed).toBe(false);
    expect(mixed.results.find((r) => !r.passed)?.detail).toContain("file missing");
  });

  it("rejects non-positive timeouts rather than silently using a default", () => {
    expect(() =>
      evaluatePredicate(workDir, {
        kind: "shell-succeeds",
        command: "true",
        timeoutMs: 0,
      }),
    ).toThrow(/timeoutMs must be positive/);
  });

  it("file-contains handles nested paths and directories with mkdir", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(join(workDir, "sub", "nested.txt"), "deep");
    const ok = evaluatePredicate(workDir, {
      kind: "file-contains",
      path: "sub/nested.txt",
      needle: "deep",
    });
    expect(ok.passed).toBe(true);
  });
});

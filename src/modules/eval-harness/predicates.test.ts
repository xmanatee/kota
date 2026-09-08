import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluatePredicate,
  evaluatePredicateExpectations,
  evaluatePredicates,
  type PredicateEvaluationContext,
} from "./predicates.js";

const ISOLATED_SHELL_CONTEXT: PredicateEvaluationContext = {
  executableVerifier: async ({ command }) => ({
    started: true,
    isolation: {
      kind: "oci-container",
      command: "test-container",
      image: "test:image",
      cliEnv: {},
      evidence: "test isolated verifier",
    },
    result: {
      signal: null,
      status: command === "true" ? 0 : 1,
      stderr: "",
      stdout: "",
    },
  }),
};

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

  it("shell-succeeds passes on isolated exit 0 and fails on non-zero", async () => {
    const ok = await evaluatePredicate(
      workDir,
      { kind: "shell-succeeds", command: "true" },
      ISOLATED_SHELL_CONTEXT,
    );
    const bad = await evaluatePredicate(
      workDir,
      { kind: "shell-succeeds", command: "false" },
      ISOLATED_SHELL_CONTEXT,
    );
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("shell-fails inverts shell-succeeds", async () => {
    const ok = await evaluatePredicate(
      workDir,
      { kind: "shell-fails", command: "false" },
      ISOLATED_SHELL_CONTEXT,
    );
    const bad = await evaluatePredicate(
      workDir,
      { kind: "shell-fails", command: "true" },
      ISOLATED_SHELL_CONTEXT,
    );
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("does not treat verifier timeout as an expected shell failure", async () => {
    const result = await evaluatePredicate(
      workDir,
      { kind: "shell-fails", command: "hang" },
      {
        executableVerifier: async () => ({
          started: true,
          isolation: {
            kind: "oci-container",
            command: "test-container",
            image: "test:image",
            cliEnv: {},
            evidence: "test isolated verifier",
          },
          result: {
            error: Object.assign(new Error("timed out"), { name: "ETIMEDOUT" }),
            signal: "SIGKILL",
            status: null,
            stderr: "",
            stdout: "",
          },
        }),
      },
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("timeout");
  });

  it("fails closed instead of executing shell predicates on the evaluator host", async () => {
    const marker = join(workDir, "host-shell-ran.txt");
    const result = await evaluatePredicate(workDir, {
      kind: "shell-succeeds",
      command: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unsafe")'`,
    });

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("verified isolated verifier");
    expect(existsSync(marker)).toBe(false);
  });

  it("evaluatePredicates passes only when every predicate passes", async () => {
    writeFileSync(join(workDir, "file.txt"), "content");
    const { passed, results } = await evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-contains", path: "file.txt", needle: "cont" },
    ]);
    expect(passed).toBe(true);
    expect(results).toHaveLength(2);

    const mixed = await evaluatePredicates(workDir, [
      { kind: "file-exists", path: "file.txt" },
      { kind: "file-exists", path: "missing.txt" },
    ]);
    expect(mixed.passed).toBe(false);
    expect(mixed.results.find((r) => !r.passed)?.detail).toContain("file missing");
  });

  it("evaluatePredicateExpectations accepts both initially true invariants and initially false outcome predicates", async () => {
    writeFileSync(join(workDir, "seed.txt"), "seed");
    const { passed, results } = await evaluatePredicateExpectations(workDir, [
      { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "pass" },
      { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
    ]);
    expect(passed).toBe(true);
    expect(results.map((r) => r.actual)).toEqual(["pass", "fail"]);
    expect(results.every((r) => r.passed)).toBe(true);

    const mismatch = await evaluatePredicateExpectations(workDir, [
      { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "fail" },
    ]);
    expect(mismatch.passed).toBe(false);
    expect(mismatch.results[0].detail).toContain("did not match expected");
  });

  it("rejects non-positive timeouts rather than silently using a default", async () => {
    await expect(
      evaluatePredicate(
        workDir,
        {
        kind: "shell-succeeds",
        command: "true",
        timeoutMs: 0,
        },
        ISOLATED_SHELL_CONTEXT,
      ),
    ).rejects.toThrow(/timeoutMs must be positive/);
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

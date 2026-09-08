import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const fixturesRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));

// These invoke scorer rejection scenarios, independently of model evaluation.
// The owner portfolio alone executes them; fixture predicates grade candidates.
it.each([
  ["product-requirements-canary", "check-requirements", "--self-test-shortcuts"],
  [
    "spec-conditioned-protocol-compliance",
    "check-protocol",
    "--self-test-shortcuts",
  ],
  ["functional-security-divergence", "check-security", "--self-test-shortcuts"],
  [
    "unfamiliar-language-strategy-construction",
    "check-strategy",
    "--self-test-shortcuts",
  ],
  [
    "algorithmic-resource-budget-canary",
    "check-resource-budget",
    "--self-test-shortcuts",
  ],
  ["formal-spec-faithfulness", "check-spec-faithfulness", "--self-test-shortcuts"],
  ["multi-service-integration", "check-integration", "--self-test-shortcuts"],
])("%s scorer rejects its known invalid candidates", (fixture, checker, flag) => {
  const workingDir = mkdtempSync(join(tmpdir(), "kota-scorer-self-test-"));
  try {
    cpSync(join(fixturesRoot, `builder-${fixture}`, "initial"), workingDir, {
      recursive: true,
    });
    const result = spawnSync(
      process.execPath,
      [`scripts/${checker}.mjs`, flag],
      { cwd: workingDir, encoding: "utf8", timeout: 20_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

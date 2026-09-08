import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const fixture = fileURLToPath(
  new URL("./fixtures/builder-eval-authoring-restraint/", import.meta.url),
);

it.each([
  ["golden/scripts/evaluate-traces.mjs", true],
  ["adversarial/constant-evaluation.mjs", false],
] as const)("scores trace sensitivity for %s", (candidate, passes) => {
  const root = mkdtempSync(join(tmpdir(), "kota-eval-authoring-scorer-"));
  try {
    cpSync(join(fixture, "initial"), root, { recursive: true });
    cpSync(join(fixture, "calibration", candidate), join(root, "scripts/evaluate-traces.mjs"));
    const result = spawnSync(process.execPath, ["scripts/check-evaluation.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status === 0, result.stderr || result.stdout).toBe(passes);
    if (!passes) expect(result.stderr).toContain("Runner variation repaired");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

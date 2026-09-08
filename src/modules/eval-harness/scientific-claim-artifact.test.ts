import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  HOLDOUT_CLAIM_EXPECTED,
  MAIN_CLAIM_EXPECTED,
  validateScientificClaimArtifactFile,
} from "./scientific-claim-artifact.js";

const fixture = fileURLToPath(
  new URL("./fixtures/builder-scientific-claim-reproduction/", import.meta.url),
);

it("accepts truthful relative command provenance and still rejects malformed evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "kota-scientific-provenance-"));
  try {
    cpSync(join(fixture, "initial"), root, { recursive: true });
    const analyzer = readFileSync(join(fixture, "calibration/analyze-claim.mjs"), "utf8")
      .replace("node scripts/analyze-claim.mjs", "node ./scripts/analyze-claim.mjs");
    writeFileSync(join(root, "scripts/analyze-claim.mjs"), analyzer);
    for (const expected of [MAIN_CLAIM_EXPECTED, HOLDOUT_CLAIM_EXPECTED]) {
      const result = spawnSync(process.execPath, [
        "./scripts/analyze-claim.mjs", "--data", expected.dataPath,
        "--output", expected.outputPath,
      ], { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(validateScientificClaimArtifactFile(root, expected, 0.000001, "claim")).toEqual([]);
    }
    const check = () => spawnSync(process.execPath, ["scripts/check-claim.mjs"], {
      cwd: root, encoding: "utf8",
    });
    expect(check().status).toBe(0);
    const path = join(root, MAIN_CLAIM_EXPECTED.outputPath);
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    for (const command of [null, 123, "", " \n "]) {
      writeFileSync(path, JSON.stringify({ ...artifact, command }));
      expect(validateScientificClaimArtifactFile(root, MAIN_CLAIM_EXPECTED, 0.000001, "claim"))
        .toContain("claim: command must be a non-empty string");
      expect(check().status).toBe(1);
    }
    writeFileSync(path, JSON.stringify({
      ...artifact, metric: { ...artifact.metric, value: 999 },
    }));
    expect(validateScientificClaimArtifactFile(root, MAIN_CLAIM_EXPECTED, 0.000001, "claim"))
      .toContain("claim: metric.value 999 differs from expected 30");
    expect(check().status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

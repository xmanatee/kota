import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateObjectiveMetrics } from "./objective-metrics.js";
import { TEST_EXECUTION_PROFILE } from "./runner-test-profiles.js";

describe("objective metric isolation", () => {
  let workingDir: string;

  beforeEach(() => {
    workingDir = mkdtempSync(join(tmpdir(), "kota-objective-metric-isolation-"));
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
  });

  it("fails closed instead of executing shell metrics on the evaluator host", async () => {
    const marker = join(workingDir, "host-metric-ran.txt");

    await expect(
      evaluateObjectiveMetrics({
        fixtureId: "unsafe-shell-metric",
        metricSpecs: [
          {
            name: "unsafe_metric",
            unit: "score",
            direction: "higher_is_better",
            source: {
              kind: "shell",
              command: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unsafe"); console.log(1)'`,
            },
          },
        ],
        workingDir,
        executionProfile: TEST_EXECUTION_PROFILE,
        runIndex: 0,
        repeatCount: 1,
      }),
    ).rejects.toMatchObject({
      reason: "source-failed",
      message: expect.stringContaining("verified isolated verifier"),
    });
    expect(existsSync(marker)).toBe(false);
  });
});

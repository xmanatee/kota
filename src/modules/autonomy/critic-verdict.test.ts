import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck, getCriticPromptHash } from "./critic.js";
import {
  type CodeCheck,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeOpenTask,
} from "./critic-test-fixture.integration.js";

// Parsing and malformed-response decisions belong to judge-response.test.ts.
// This boundary proves that the critic publishes its verdict and gates repair.
describe("critic verdict handling", () => {
  beforeEach(resetCriticTestMocks);

  it.each(["pass", "pass_with_warnings", "fail"] as const)(
    "persists the %s verdict and propagates its disposition",
    async (verdict) => {
      const dir = makeTmpDir();
      writeOpenTask(dir, "task-review.md", "---\nstatus: open\npriority: p2\n---\n\n# Review the implementation\n");
      const runDir = makeRunDir(dir);
      const response = {
        verdict,
        critical_issues: verdict === "fail" ? ["The API returns another scope's data."] : [],
        warnings: verdict === "pass_with_warnings" ? ["The error message could be clearer."] : [],
        summary: "The review's detailed evidence stays in its artifact.",
      };
      setApiResponse(response);
      const check = createCriticCheck({ runDirPath: runDir }) as CodeCheck;
      const result = check.run(makeContext(dir, runDir), TEST_PARENT_STEP);

      if (verdict === "fail") {
        await expect(result).rejects.toThrow(/1 critical issue/);
        await expect(result).rejects.toThrow(`Review ${join(runDir, "critic-review.json")}`);
        await expect(result).rejects.not.toThrow(response.critical_issues[0]);
        await expect(result).rejects.not.toThrow(response.summary);
      } else {
        await expect(result).resolves.toContain(`verdict — ${verdict}`);
        if (verdict === "pass_with_warnings") await expect(result).resolves.toContain("1 warning");
      }
      expect(JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8")))
        .toMatchObject({ ...response, reviewerPromptHash: getCriticPromptHash(dir) });
    },
  );
});

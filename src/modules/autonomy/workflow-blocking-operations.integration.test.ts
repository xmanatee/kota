import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { dailyDigestBuildOperation } from "#modules/autonomy/workflows/daily-digest/blocking-operations.js";
import { securityReviewCandidateScanOperation } from "#modules/autonomy/workflows/security-review/blocking-operations.js";

describe("autonomy workflow blocking operations", () => {
  it("loads migrated repository inspections and aggregation through real workers", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-blocking-boundary-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "kota@example.test"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "KOTA Test"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      writeFileSync(join(projectDir, "README.md"), "boundary fixture\n");
      writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n");
      execFileSync("git", ["add", ".gitignore", "README.md"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-q", "-m", "initial"], {
        cwd: projectDir,
        stdio: "ignore",
      });

      const scan = await runWorkflowBlockingOperation(
        securityReviewCandidateScanOperation,
        {
          projectDir,
          runDirPath: join(projectDir, ".kota", "runs", "boundary-test"),
          trigger: {
            event: "autonomy.security-review.requested",
            payload: {},
          },
        },
      );
      const digestRunDir = join(projectDir, ".kota", "runs", "digest-boundary");
      mkdirSync(digestRunDir, { recursive: true });
      const digest = await runWorkflowBlockingOperation(
        dailyDigestBuildOperation,
        {
          projectDir,
          stateDir: join(projectDir, ".kota"),
          runDirPath: digestRunDir,
          windowEndMs: Date.parse("2026-08-14T12:00:00.000Z"),
          previousQueueCounts: null,
        },
      );
      expect(scan.candidateCount).toBe(0);
      expect(digest).toMatchObject({
        data: { quiet: true },
        currentCounts: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

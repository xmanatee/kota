import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { workflowCommitOperation } from "./workflow-commit-operations.js";

function runGit(projectDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: projectDir, stdio: "ignore" });
}

describe("workflow commit blocking operation", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the event loop live while a slow Git hook runs", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-commit-worker-"));
    roots.push(projectDir);
    runGit(projectDir, ["init", "--quiet"]);
    runGit(projectDir, ["config", "user.name", "Kota Tests"]);
    runGit(projectDir, ["config", "user.email", "kota@example.com"]);
    writeFileSync(join(projectDir, "tracked.txt"), "initial\n", "utf8");
    runGit(projectDir, ["add", "tracked.txt"]);
    runGit(projectDir, ["commit", "--quiet", "-m", "initial"]);

    const hooksDir = join(projectDir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const preCommitPath = join(hooksDir, "pre-commit");
    writeFileSync(preCommitPath, "#!/bin/sh\nsleep 0.25\n", "utf8");
    chmodSync(preCommitPath, 0o755);
    runGit(projectDir, ["config", "core.hooksPath", hooksDir]);

    writeFileSync(join(projectDir, "tracked.txt"), "changed\n", "utf8");
    const runDirPath = join(projectDir, ".kota", "runs", "commit-worker");
    mkdirSync(runDirPath, { recursive: true });
    writeFileSync(
      join(runDirPath, "commit-message.txt"),
      "test: commit through worker\n",
      "utf8",
    );

    let eventLoopTicks = 0;
    const interval = setInterval(() => {
      eventLoopTicks += 1;
    }, 10);
    try {
      const result = await runWorkflowBlockingOperation(
        workflowCommitOperation,
        {
          projectDir,
          runDirPath,
          policy: { kind: "exact-paths", paths: ["tracked.txt"] },
        },
      );
      expect(result).toMatchObject({
        committed: true,
        committedPaths: ["tracked.txt"],
        daemonRestartRequired: true,
      });
      expect(eventLoopTicks).toBeGreaterThanOrEqual(10);
    } finally {
      clearInterval(interval);
    }
  });
});

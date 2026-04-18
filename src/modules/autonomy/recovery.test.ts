import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { onNormalTrigger, onRecoveryTrigger, resetWorktreeForRecovery } from "./recovery.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-recovery-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Kota"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, ".gitignore"), ".kota/\n");
  writeFileSync(join(dir, "README.md"), "clean\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

describe("resetWorktreeForRecovery", () => {
  it("no-ops on a clean worktree", () => {
    const dir = initRepo();
    const result = resetWorktreeForRecovery({ projectDir: dir, workflowName: "test" });
    expect(result.stashed).toBe(false);
    expect(result.branchRestored).toBe(false);
  });

  it("stashes tracked dirt and leaves worktree clean", () => {
    const dir = initRepo();
    writeFileSync(join(dir, "README.md"), "dirty\n");
    expect(getRepoWorktreeStatus(dir).trackedDirty).toBe(true);

    const result = resetWorktreeForRecovery({ projectDir: dir, workflowName: "builder" });

    expect(result.stashed).toBe(true);
    expect(getRepoWorktreeStatus(dir).trackedDirty).toBe(false);
  });

  it("switches from kota/task/* back to base branch when restoreBaseBranch is true", () => {
    const dir = initRepo();
    execFileSync("git", ["checkout", "-b", "kota/task/foo"], { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "dirty on task branch\n");

    const result = resetWorktreeForRecovery({
      projectDir: dir,
      workflowName: "builder",
      restoreBaseBranch: true,
    });

    expect(result.stashed).toBe(true);
    expect(result.branchRestored).toBe(true);
    expect(result.previousBranch).toBe("kota/task/foo");
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("main");
  });

  it("does not touch branch when already on base", () => {
    const dir = initRepo();
    writeFileSync(join(dir, "README.md"), "dirty\n");

    const result = resetWorktreeForRecovery({
      projectDir: dir,
      workflowName: "builder",
      restoreBaseBranch: true,
    });

    expect(result.stashed).toBe(true);
    expect(result.branchRestored).toBe(false);
    expect(result.previousBranch).toBeNull();
  });

  it("leaves non-kota branches alone even with restoreBaseBranch", () => {
    const dir = initRepo();
    execFileSync("git", ["checkout", "-b", "feature/manual"], { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "dirty\n");

    const result = resetWorktreeForRecovery({
      projectDir: dir,
      workflowName: "builder",
      restoreBaseBranch: true,
    });

    expect(result.branchRestored).toBe(false);
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("feature/manual");
  });
});

describe("recovery predicates skipLabel", () => {
  it("onNormalTrigger carries the recovery-trigger-gate label", () => {
    expect(onNormalTrigger.skipLabel).toBe("recovery-trigger-gate");
  });

  it("onRecoveryTrigger carries the recovery-only-step label", () => {
    expect(onRecoveryTrigger.skipLabel).toBe("recovery-only-step");
  });
});

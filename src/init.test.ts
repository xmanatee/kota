import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetTaskStore, setTaskStoreInstance, TaskStore } from "#core/daemon/task-store.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { buildSessionWarmup } from "./init.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kota-warmup-"));
  initProviderRegistry();
  setTaskStoreInstance(new TaskStore(dir, null));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 10, 12));
});
afterEach(() => {
  resetProviderRegistry();
  resetTaskStore();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

it("provides directory and local system context when optional sources are absent", () => {
  const result = buildSessionWarmup(dir);
  expect(result).toContain(`**Working directory**: ${dir}`);
  expect(result).toContain("Date: 2026-09-10 (Thursday) | Platform:");
  for (const heading of ["Git", "Workspace", "Environment", "Directory", "Active tasks", "Scheduled reminders", "Recalled from memory", "Knowledge base", "Previous conversation"]) {
    expect(result).not.toContain(`**${heading}`);
  }
});

it("renders workspace context in preference to a file-based environment", () => {
  mkdirSync(join(dir, "reports"));
  writeFileSync(join(dir, "data.csv"), "a,b");
  let result = buildSessionWarmup(dir);
  expect(result).toContain("**Environment**: Workspace with 1 data file");
  expect(result).toContain("**Directory**:");
  expect(result).toContain("reports/");
  expect(result).toContain("data.csv");
  writeFileSync(join(dir, "package.json"), '{"name":"test-proj"}');
  result = buildSessionWarmup(dir);
  expect(result).toContain("**Workspace**: Node.js workspace — test-proj");
  expect(result).not.toContain("**Environment**:");
});

it("renders real Git context as a disposable repository changes", () => {
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: dir, stdio: "pipe", env: { ...process.env,
      GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" },
  });
  git("init");
  for (const name of ["to-delete", "old-name", "to-modify"]) writeFileSync(join(dir, name), name);
  git("add", ".");
  git("commit", "-m", "warmup fixture");
  expect(buildSessionWarmup(dir)).toContain("Working tree: clean");
  rmSync(join(dir, "to-delete"));
  git("mv", "old-name", "new-name");
  writeFileSync(join(dir, "to-modify"), "changed");
  writeFileSync(join(dir, "untracked"), "new");
  const result = buildSessionWarmup(dir);
  expect(result).toContain("**Git**:");
  expect(result).toContain("Working tree: 1 modified, 1 deleted, 1 untracked, 1 renamed");
  expect(result).toContain("warmup fixture");
});

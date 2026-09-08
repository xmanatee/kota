import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SCOPE_TEST_NOW = new Date("2026-08-15T12:00:00.000Z");

export function runScopeFixtureGit(workspaceRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function makeScopeFixture(label: string): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `kota-scope-semantic-${label}-`));
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n", "utf8");
  runScopeFixtureGit(workspaceRoot, ["init", "--quiet"]);
  runScopeFixtureGit(workspaceRoot, ["add", "."]);
  runScopeFixtureGit(workspaceRoot, [
    "-c",
    "user.email=kota@example.test",
    "-c",
    "user.name=KOTA Test",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "initial scope",
  ]);
  return workspaceRoot;
}

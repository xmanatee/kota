import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

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
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(workspaceRoot, "data", "tasks", state), { recursive: true });
    writeFileSync(join(workspaceRoot, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
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

export function automaticScopeRequest(
  workspaceRoot: string,
  boundary: "initial-onboarding" | "content-policy-changed",
) {
  const scopePolicySnapshot = scopePolicySnapshotForTest(workspaceRoot);
  const fingerprint = computeScopeContentFingerprint(
    workspaceRoot,
    scopePolicySnapshot.policy,
  );
  return {
    event: boundary === "initial-onboarding"
      ? "autonomy.scope-improvement.requested"
      : "autonomy.scope-improvement.changed",
    schemaRef: null,
    payload: {
      automatic: true,
      boundary,
      fingerprint: fingerprint.fingerprint,
      evidenceRefs: fingerprint.refs,
      reason: boundary,
    },
  };
}

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

export const SCOPE_TEST_NOW = new Date("2026-08-15T12:00:00.000Z");

export function runScopeFixtureGit(projectDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function makeScopeFixture(label: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), `kota-scope-semantic-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(projectDir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n", "utf8");
  runScopeFixtureGit(projectDir, ["init", "--quiet"]);
  runScopeFixtureGit(projectDir, ["add", "."]);
  runScopeFixtureGit(projectDir, [
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
  return projectDir;
}

export function automaticScopeRequest(
  projectDir: string,
  boundary: "initial-onboarding" | "content-policy-changed",
) {
  const scopePolicySnapshot = scopePolicySnapshotForTest(projectDir);
  const fingerprint = computeScopeContentFingerprint(
    projectDir,
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

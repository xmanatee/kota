import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

describe("scope content fingerprint", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function write(projectDir: string, path: string, content: string): void {
    const absolute = join(projectDir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }

  it("ignores builder worktrees and runtime evidence guidance files", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-"));
    projectDirs.push(projectDir);
    write(projectDir, "AGENTS.md", "# Durable scope guidance\n");
    write(projectDir, ".kota/config.json", '{"autonomy":{"enabled":true}}\n');
    const policy = scopePolicySnapshotForTest(projectDir).policy;
    const durable = computeScopeContentFingerprint(projectDir, policy);

    write(
      projectDir,
      ".worktrees/task-builder/AGENTS.md",
      "# Transient builder worktree guidance\n",
    );
    write(
      projectDir,
      ".kota/runs/failed-builder/evidence/AGENTS.md",
      "# Transient recovery evidence\n",
    );

    expect(computeScopeContentFingerprint(projectDir, policy)).toEqual(durable);
    expect(durable.refs).toEqual([
      "AGENTS.md",
      `scope-policy:${deriveDirectoryScopeId(projectDir)}`,
    ]);
  });

  it("ignores project-config formatting but changes for resolved authority policy", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-policy-"));
    projectDirs.push(projectDir);
    write(projectDir, "AGENTS.md", "# Durable scope guidance\n");
    write(projectDir, ".kota/config.json", '{"autonomy":{"enabled":true}}\n');
    const initialPolicy = scopePolicySnapshotForTest(projectDir).policy;
    const initial = computeScopeContentFingerprint(projectDir, initialPolicy);

    write(
      projectDir,
      ".kota/config.json",
      '{\n  "autonomy": {\n    "enabled": true\n  }\n}\n',
    );
    expect(computeScopeContentFingerprint(projectDir, initialPolicy)).toEqual(initial);

    const scopeId = deriveDirectoryScopeId(projectDir);
    const restrictedPolicy = scopePolicySnapshotForTest(
      projectDir,
      [{
        scopeId,
        reason: "Restrict writes for this scope.",
        writes: { mode: "none" },
      }],
      1,
    ).policy;
    expect(
      computeScopeContentFingerprint(projectDir, restrictedPolicy).fingerprint,
    ).not.toBe(initial.fingerprint);
  });

  it("canonicalizes scope-improvement config JSON", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-config-"));
    projectDirs.push(projectDir);
    const policy = scopePolicySnapshotForTest(projectDir).policy;
    write(
      projectDir,
      ".kota/scope-improvement/config.json",
      '{"enabled":true,"maxActionsPerRun":2}\n',
    );
    const compact = computeScopeContentFingerprint(projectDir, policy);

    write(
      projectDir,
      ".kota/scope-improvement/config.json",
      '{\n  "maxActionsPerRun": 2,\n  "enabled": true\n}\n',
    );
    expect(computeScopeContentFingerprint(projectDir, policy)).toEqual(compact);
  });

  it("combines an isolated repository view with canonical scope policy", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-view-"));
    const scopeDir = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-scope-"));
    projectDirs.push(projectDir, scopeDir);
    write(projectDir, "AGENTS.md", "# Isolated repository guidance\n");
    const policy = scopePolicySnapshotForTest(scopeDir).policy;

    expect(computeScopeContentFingerprint(projectDir, policy)).toMatchObject({
      refs: ["AGENTS.md", `scope-policy:${deriveDirectoryScopeId(scopeDir)}`],
    });
  });
});

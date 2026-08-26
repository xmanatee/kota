import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

describe("scope content fingerprint", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function write(workspaceRoot: string, path: string, content: string): void {
    const absolute = join(workspaceRoot, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }

  it("ignores builder worktrees and runtime evidence guidance files", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-"));
    scopeRoots.push(workspaceRoot);
    write(workspaceRoot, "AGENTS.md", "# Durable scope guidance\n");
    write(workspaceRoot, ".kota/config.json", '{"autonomy":{"enabled":true}}\n');
    const policy = scopePolicySnapshotForTest(workspaceRoot).policy;
    const durable = computeScopeContentFingerprint(workspaceRoot, policy);

    write(
      workspaceRoot,
      ".worktrees/task-builder/AGENTS.md",
      "# Transient builder worktree guidance\n",
    );
    write(
      workspaceRoot,
      ".kota/runs/failed-builder/evidence/AGENTS.md",
      "# Transient recovery evidence\n",
    );

    expect(computeScopeContentFingerprint(workspaceRoot, policy)).toEqual(durable);
    expect(durable.refs).toEqual([
      "AGENTS.md",
      `scope-policy:${deriveDirectoryScopeId(workspaceRoot)}`,
    ]);
  });

  it("ignores scope-config formatting but changes for resolved authority policy", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-policy-"));
    scopeRoots.push(workspaceRoot);
    write(workspaceRoot, "AGENTS.md", "# Durable scope guidance\n");
    write(workspaceRoot, ".kota/config.json", '{"autonomy":{"enabled":true}}\n');
    const initialPolicy = scopePolicySnapshotForTest(workspaceRoot).policy;
    const initial = computeScopeContentFingerprint(workspaceRoot, initialPolicy);

    write(
      workspaceRoot,
      ".kota/config.json",
      '{\n  "autonomy": {\n    "enabled": true\n  }\n}\n',
    );
    expect(computeScopeContentFingerprint(workspaceRoot, initialPolicy)).toEqual(initial);

    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const restrictedPolicy = scopePolicySnapshotForTest(
      workspaceRoot,
      [{
        scopeId,
        reason: "Restrict writes for this scope.",
        writes: { mode: "none" },
      }],
      1,
    ).policy;
    expect(
      computeScopeContentFingerprint(workspaceRoot, restrictedPolicy).fingerprint,
    ).not.toBe(initial.fingerprint);
  });

  it("canonicalizes scope-improvement config JSON", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-config-"));
    scopeRoots.push(workspaceRoot);
    const policy = scopePolicySnapshotForTest(workspaceRoot).policy;
    write(
      workspaceRoot,
      ".kota/scope-improvement/config.json",
      '{"enabled":true,"maxActionsPerRun":2}\n',
    );
    const compact = computeScopeContentFingerprint(workspaceRoot, policy);

    write(
      workspaceRoot,
      ".kota/scope-improvement/config.json",
      '{\n  "maxActionsPerRun": 2,\n  "enabled": true\n}\n',
    );
    expect(computeScopeContentFingerprint(workspaceRoot, policy)).toEqual(compact);
  });

  it("rejects a resolved policy snapshot from another scope", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-owner-"));
    const otherScopeRoot = mkdtempSync(join(tmpdir(), "kota-scope-fingerprint-other-"));
    scopeRoots.push(workspaceRoot, otherScopeRoot);

    expect(() =>
      computeScopeContentFingerprint(
        workspaceRoot,
        scopePolicySnapshotForTest(otherScopeRoot).policy,
      )
    ).toThrow(/does not belong/);
  });
});

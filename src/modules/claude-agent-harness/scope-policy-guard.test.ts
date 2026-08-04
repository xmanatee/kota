import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import type { ScopeRegistryProjection } from "#core/daemon/scope-registry.js";
import { createClaudeScopePolicyGuard } from "./scope-policy-guard.js";

const PROJECTION: ScopeRegistryProjection = {
  rootScopeId: "global",
  defaultScopeId: "workspace",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "workspace",
      displayName: "Workspace",
      parentScopeId: "global",
      directoryRoot: "/tmp/workspace",
    },
  ],
};

const CONTEXT = {
  signal: new AbortController().signal,
  toolUseId: "tool-use-1",
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createClaudeScopePolicyGuard", () => {
  it("resolves current authority before every intercepted Claude tool call", async () => {
    const initialPolicy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const restrictedPolicy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "Writes were revoked.",
        writes: { mode: "none" },
      }],
    });
    let snapshot = { revision: 0, policy: initialPolicy };
    const getScopePolicySnapshot = vi.fn(() => snapshot);
    const guard = createClaudeScopePolicyGuard({
      policy: initialPolicy,
      autonomyMode: "autonomous",
      getScopePolicySnapshot,
      cwd: "/tmp/workspace",
    });

    await expect(
      guard("Write", { file_path: "/tmp/workspace/out.ts" }, CONTEXT),
    ).resolves.toMatchObject({ behavior: "allow" });
    snapshot = { revision: 1, policy: restrictedPolicy };
    await expect(
      guard("Write", { file_path: "/tmp/workspace/out.ts" }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("writes are disabled"),
    });
    expect(getScopePolicySnapshot).toHaveBeenCalledTimes(2);
  });

  it("applies a restrictive live autonomy cap before the next Claude tool call", async () => {
    const initialPolicy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const passivePolicy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "Autonomous writes were revoked.",
        autonomy: { defaultMode: "passive", maxMode: "passive" },
      }],
    });
    let snapshot = { revision: 0, policy: initialPolicy };
    const getScopePolicySnapshot = vi.fn(() => snapshot);
    const guard = createClaudeScopePolicyGuard({
      policy: initialPolicy,
      autonomyMode: "autonomous",
      getScopePolicySnapshot,
      cwd: "/tmp/workspace",
    });
    const writeImplementation = vi.fn();
    const invokeWrite = async () => {
      const decision = await guard(
        "Write",
        { file_path: "/tmp/workspace/out.ts" },
        CONTEXT,
      );
      if (decision.behavior === "allow") writeImplementation();
      return decision;
    };

    await expect(invokeWrite()).resolves.toMatchObject({ behavior: "allow" });
    snapshot = { revision: 1, policy: passivePolicy };
    await expect(invokeWrite()).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining('autonomy mode "passive"'),
    });
    expect(writeImplementation).toHaveBeenCalledTimes(1);
    expect(getScopePolicySnapshot).toHaveBeenCalledTimes(2);
  });

  it("applies write boundaries to normalized Claude file paths", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [
        {
          scopeId: "workspace",
          reason: "Generated files only.",
          writes: { mode: "paths", paths: ["generated"] },
        },
      ],
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
      cwd: "/tmp/workspace",
    });

    await expect(
      guard("Write", { file_path: "/tmp/workspace/generated/out.ts" }, CONTEXT),
    ).resolves.toMatchObject({ behavior: "allow" });
    await expect(
      guard("Edit", { file_path: "/tmp/workspace/src/index.ts" }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("outside the allowed write paths"),
    });
  });

  it("denies opaque Bash writes under a scope-directory boundary", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "Writes stay inside the registered directory.",
        writes: { mode: "scope-directory" },
      }],
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
      cwd: "/tmp/workspace",
    });

    await expect(
      guard(
        "Bash",
        { command: "printf escaped > /tmp/outside-scope", cwd: "/tmp/workspace" },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("does not expose a complete filesystem target"),
    });
  });

  it("applies external-effect policy to Bash network reads and writes", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
      fragments: [{
        scopeId: "workspace",
        reason: "External effects are disabled.",
        externalEffects: {
          networkRead: "deny",
          networkWrite: "deny",
          networkDestructive: "deny",
        },
      }],
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
      cwd: "/tmp/workspace",
    });

    await expect(
      guard("Bash", { command: "curl https://example.com/status" }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("read on external-network"),
    });
    await expect(
      guard("Bash", {
        command:
          "node -e \"fetch('https://example.com/items', { method: 'POST' })\"",
      }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("write on external-network"),
    });
  });

  it("blocks confirmation decisions when no approval queue can persist them", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
      cwd: "/tmp/workspace",
    });

    await expect(
      guard("Bash", { command: "rm -rf build" }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("approval queue is unavailable"),
    });
  });

  it("persists confirmation decisions in the scope approval queue", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const dir = mkdtempSync(join(tmpdir(), "kota-claude-scope-policy-"));
    tempDirs.push(dir);
    const approvalQueue = new ApprovalQueue(
      join(dir, "approvals"),
      null,
      { scopeId: "workspace" },
    );
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
      approvalQueue,
      cwd: "/tmp/workspace",
      sessionId: "session-1",
    });

    await expect(
      guard("Bash", { command: "rm -rf build" }, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringMatching(/^Queued for approval \[[^\]]+\]/),
    });
    expect(approvalQueue.list("pending")).toEqual([
      expect.objectContaining({
        tool: "Bash",
        risk: "dangerous",
        status: "pending",
      }),
    ]);
  });

  it("denies unbound Claude tools instead of silently bypassing policy", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
    });

    await expect(
      guard("FutureUnknownTool", {}, CONTEXT),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("no effect-aware policy binding"),
    });
  });

  it("denies the machine-owned authority token to native Claude tools", async () => {
    const policy = resolveScopePolicy({
      projection: PROJECTION,
      scopeId: "workspace",
    });
    const guard = createClaudeScopePolicyGuard({
      policy,
      autonomyMode: "autonomous",
    });

    await expect(
      guard(
        "Read",
        { file_path: "/Users/operator/.kota/scope-authority-token.json" },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("not agent-readable"),
    });
  });
});

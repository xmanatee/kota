import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { getExecuteToolSet } from "#core/agents/delegate-prompts.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { executeDelegateToolBlocks } from "#core/tools/delegate-turn-tools.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolCallExecutionOptions } from "#core/tools/tool-runner.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { approvedApprovalResponse, closeApprovalExecutionLeases, prepareApprovalExecutionBatch } from "#modules/approval-queue/approval-execution.js";
import execution from "#modules/execution/index.js";
import filesystem from "#modules/filesystem/index.js";
import git from "#modules/git/index.js";
import rendering from "#modules/rendering/index.js";
import webAccess from "#modules/web-access/index.js";

// Detects Git's broad network declaration masking opaque filesystem effects.
// Intercept dispatch after real authorization so this probe never invokes Git.
it("denies opaque Git operations under bounded filesystem policies", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-tool-targets-"));
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const dispatched = vi.fn(async () => ({ content: "dispatch intercepted" }));
  const dispose = getToolMiddleware().add("git-authorization-probe", dispatched);
  const policies: Partial<ToolCallExecutionOptions>[] = [
    { agentWriteScope: "deny-all" },
    { agentWriteScope: ["allowed/"] },
    ...(["none", "paths"] as const).map((mode) => ({
      scopePolicy: resolveScopePolicy({
        projection: { rootScopeId: "global", defaultScopeId: "probe", scopes: [
          { scopeId: "global", displayName: "Global" },
          { scopeId: "probe", displayName: "Probe", parentScopeId: "global", directoryRoot: root },
        ] },
        scopeId: "probe", fragments: [{
          scopeId: "global", reason: "Network effects authorized for this probe",
          externalEffects: { networkWrite: "allow", networkDestructive: "allow" },
          ownerConfirmation: { externalWrite: "allow", destructive: "allow" },
        }, {
          scopeId: "probe", reason: "Filesystem restrictions with network permission",
          writes: mode === "none" ? { mode } : { mode, paths: ["allowed/"] },
        }],
      }),
    })),
  ];
  const invoke = (input: Record<string, unknown>, policy: Partial<ToolCallExecutionOptions>) =>
    executeToolCalls([{ type: "tool_use", id: "git-probe", name: "git", input }], {
      resultLimit: 10000, verbose: false, autonomyMode: "autonomous", cwd: root, scopeRoot: root,
      guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "allow" } },
      ...policy,
    });
  try {
    await loader.loadAll([git]);
    for (const policy of policies) {
      for (const input of [
        { op: "add", args: "allowed/file" }, { op: "commit", args: "Synthetic commit" },
        { op: "branch", args: "feature" }, { op: "branch", args: "switch feature" },
        { op: "branch", args: "-d feature" }, { op: "push", args: "origin HEAD:feature" },
      ]) {
        expect((await invoke({ ...input, path: "allowed/decoy" }, policy))[0])
          .toMatchObject({ is_error: true, content: expect.stringMatching(/Blocked by (agent write scope|scope policy)/) });
      }
    }
    expect(dispatched).not.toHaveBeenCalled();
    for (const policy of policies) {
      for (const op of ["status", "diff", "log", "show", "branch"]) {
        expect((await invoke({ op }, policy))[0]).toMatchObject({ is_error: true });
      }
    }
    expect((await invoke({ op: "add", args: "allowed/file" }, {}))[0])
      .toMatchObject({ content: "dispatch intercepted" });
  } finally {
    dispose();
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// Runs the actual executor and Git subprocess: a configured observation hook
// demonstrates why read intent cannot declare an empty set of mutation targets.
it("denies configured Git read helpers under both write gates", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-read-helper-"));
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const marker = join(root, "helper-ran");
  const hook = join(root, "fsmonitor");
  try {
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(hook, "#!/bin/sh\nprintf invoked > helper-ran\nprintf 'token\\0'\n");
    chmodSync(hook, 0o755);
    execFileSync("git", ["config", "core.fsmonitor", hook], { cwd: root });
    await loader.loadAll([git]);
    const invoke = (policy: Partial<ToolCallExecutionOptions>) => executeToolCalls([{
      type: "tool_use", id: "status", name: "git", input: { op: "status" },
    }], {
      resultLimit: 10000, verbose: false, autonomyMode: "autonomous",
      cwd: root, scopeRoot: root, ...policy,
    });
    const scopePolicy = resolveScopePolicy({
      projection: { rootScopeId: "global", defaultScopeId: "probe", scopes: [
        { scopeId: "global", displayName: "Global" },
        { scopeId: "probe", displayName: "Probe", parentScopeId: "global", directoryRoot: root },
      ] },
      scopeId: "probe", fragments: [{ scopeId: "probe", reason: "Read-only", writes: { mode: "none" } }],
    });
    for (const policy of [{ agentWriteScope: "deny-all" as const }, { scopePolicy }]) {
      expect((await invoke(policy))[0]).toMatchObject({ is_error: true });
      expect(existsSync(marker)).toBe(false);
    }
    expect((await invoke({}))[0]).not.toHaveProperty("is_error", true);
    expect(readFileSync(marker, "utf8")).toBe("invoked");
  } finally {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// Detects opaque shell approval resumption changing a relative write's root,
// both before preflight and after the reviewed runner has been leased.
it("keeps opaque shell approvals bound to their reviewed execution roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-approval-roots-"));
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const queue = new ApprovalQueue(join(root, "state"));
  const context = { cwd: worktree, scopeRoot: root };
  try {
    await loader.loadAll([rendering, execution]);
    const [queued] = await executeToolCalls([{
      type: "tool_use", id: "shell-write", name: "shell",
      input: { command: "echo synthetic > proof.txt", stream_output: false },
    }], {
      resultLimit: 10000, verbose: false, autonomyMode: "supervised",
      approvalQueue: queue, ...context,
    });
    expect(queued?.content).toContain("Queued for approval");
    const item = queue.list("pending")[0];
    if (!item) throw new Error("Expected shell approval");
    const selection = queue.getExecutionSnapshot(item.id);
    if (!selection.ok) throw new Error("Expected execution snapshot");
    const altered = structuredClone(selection.snapshot);
    if (!altered.approval.localToolDeclaration?.executionRoots) throw new Error("Expected reviewed roots");
    altered.approval.localToolDeclaration.executionRoots.cwd = root;
    expect(await prepareApprovalExecutionBatch([altered], { scopeRoot: root })).toMatchObject({
      ok: false, body: { reason: "local_tool_declaration_effect_changed_since_review" },
    });
    for (const changed of [{ ...context, cwd: root }, { ...context, scopeRoot: worktree }]) {
      expect(await prepareApprovalExecutionBatch([selection.snapshot], changed)).toMatchObject({
        ok: false, body: { reason: "local_tool_declaration_effect_changed_since_review" },
      });
    }
    expect(queue.get(item.id)?.status).toBe("pending");
    const preflight = await prepareApprovalExecutionBatch([selection.snapshot], context);
    if (!preflight.ok) throw new Error("Expected unchanged roots to pass");
    try {
      const lease = preflight.leases.get(item.id);
      if (!lease) throw new Error("Expected shell lease");
      const approved = queue.approveForExecution(lease);
      if (!approved.ok) throw new Error("Expected approval");
      expect(await approvedApprovalResponse(approved.approval, { ...context, cwd: root }, lease)).toMatchObject({
        resolution: { kind: "tool_execution", execution: { status: "failed" } },
      });
      expect(existsSync(join(root, "proof.txt"))).toBe(false);
      expect(existsSync(join(worktree, "proof.txt"))).toBe(false);
      expect(await approvedApprovalResponse(approved.approval, context, lease)).toMatchObject({
        resolution: { kind: "tool_execution", execution: { status: "succeeded" } },
      });
      expect(readFileSync(join(worktree, "proof.txt"), "utf8")).toBe("synthetic\n");
      expect(existsSync(join(root, "proof.txt"))).toBe(false);
    } finally {
      await closeApprovalExecutionLeases(preflight.leases.values());
    }
  } finally {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// Detects declaration rejection or lost target metadata between module loading
// and the hosted executor, using the real batch editor's persisted outputs.
it("carries the filesystem module's complete destinations through admission and execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "module-tool-targets-"));
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const scopePolicy = resolveScopePolicy({
    projection: {
      rootScopeId: "global", defaultScopeId: "probe", scopes: [
        { scopeId: "global", displayName: "Global" },
        { scopeId: "probe", displayName: "Probe", parentScopeId: "global", directoryRoot: root },
      ],
    },
    scopeId: "probe",
    fragments: [{ scopeId: "probe", reason: "Generated outputs only", writes: { mode: "paths", paths: ["allowed/"] } }],
  });
  mkdirSync(join(root, "allowed"));
  for (const path of ["allowed/a.txt", "allowed/b.txt", "outside.txt"]) {
    writeFileSync(join(root, path), "original");
  }
  const edit = async (secondPath: string) => executeToolCalls([{
    type: "tool_use", id: "batch", name: "multi_edit", input: {
      path: "allowed/decoy.txt",
      edits: ["allowed/a.txt", secondPath].map((path) => ({
        path, old_string: "original", new_string: "changed",
      })),
    },
  }], {
    resultLimit: 10000, verbose: false, autonomyMode: "autonomous",
    cwd: root, scopeRoot: root, scopePolicy,
  });
  try {
    await loader.loadAll([rendering, filesystem]);
    expect((await edit("outside.txt"))[0]).toMatchObject({ is_error: true });
    expect(readFileSync(join(root, "allowed/a.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("original");
    expect((await edit("allowed/b.txt"))[0]).not.toHaveProperty("is_error", true);
    expect(readFileSync(join(root, "allowed/a.txt"), "utf8")).toBe("changed");
    expect(readFileSync(join(root, "allowed/b.txt"), "utf8")).toBe("changed");
  } finally {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// Detects a network effect masking a filesystem destination, with real transport
// policy, module registration, tool execution and persisted response bytes.
it("checks ancillary download destinations while retaining ordinary network reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "download-tool-targets-"));
  mkdirSync(join(root, "allowed"));
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const dispatcher = vi.fn(async () => new Response("downloaded"));
  const transport = new OutboundHttpTransport({
    dispatcher,
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const request = vi.spyOn(outboundHttp, "request").mockImplementation((input) => transport.request(input));
  const policy = resolveScopePolicy({
    projection: { rootScopeId: "global", defaultScopeId: "probe", scopes: [
      { scopeId: "global", displayName: "Global" },
      { scopeId: "probe", displayName: "Probe", parentScopeId: "global", directoryRoot: root },
    ] },
    scopeId: "probe", fragments: [{ scopeId: "probe", reason: "Downloads only", writes: { mode: "paths", paths: ["allowed/"] } }],
  });
  const invoke = (saveTo: string | undefined, gate: "agent" | "scope") => executeToolCalls([{
    type: "tool_use", id: "download", name: "web_fetch",
    input: { url: "https://example.com/report", path: "allowed/decoy", ...(saveTo ? { save_to: saveTo } : {}) },
  }], {
    resultLimit: 10000, verbose: false, autonomyMode: "autonomous", cwd: root, scopeRoot: root,
    ...(gate === "agent" ? { agentWriteScope: ["allowed/"] } : { scopePolicy: policy }),
  });
  try {
    await loader.loadAll([webAccess]);
    for (const gate of ["agent", "scope"] as const) {
      expect((await invoke("outside", gate))[0]).toMatchObject({ is_error: true });
      expect((await invoke("../escape", gate))[0]).toMatchObject({ is_error: true });
    }
    expect(dispatcher).not.toHaveBeenCalled();
    expect(existsSync(join(root, "outside"))).toBe(false);
    for (const gate of ["agent", "scope"] as const) {
      expect((await invoke(`allowed/${gate}`, gate))[0]).not.toHaveProperty("is_error", true);
      expect(readFileSync(join(root, "allowed", gate), "utf8")).toBe("downloaded");
    }
    expect((await invoke(undefined, "agent"))[0]).not.toHaveProperty("is_error", true);
    expect(existsSync(join(root, "allowed/decoy"))).toBe(false);
  } finally {
    request.mockRestore();
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// Detects delegate tool-set adapters losing registered operation identity while
// retaining opaque-shell denial and the reviewed timeout on approval resumption.
it("authorizes delegated shell through its registered operation", async () => {
  const root = mkdtempSync(join(tmpdir(), "delegate-shell-targets-"));
  const loader = new ModuleLoader({}, false, { mode: "runtime" });
  loader.setCwd(root);
  loader.setBus(new EventBus());
  const queue = new ApprovalQueue(join(root, "state"));
  const context = { cwd: root, scopeRoot: root };
  const policy = (bounded: boolean) => resolveScopePolicy({
    projection: { rootScopeId: "global", defaultScopeId: "probe", scopes: [
      { scopeId: "global", displayName: "Global" },
      { scopeId: "probe", displayName: "Probe", parentScopeId: "global", directoryRoot: root },
    ] },
    scopeId: "probe", fragments: [{ scopeId: "probe", reason: "Delegate probe",
      ...(bounded ? { writes: { mode: "paths" as const, paths: ["allowed/"] } } : {}),
    }],
  });
  try {
    await loader.loadAll([rendering, execution]);
    const invoke = (command: string, options: Partial<ToolCallExecutionOptions> = {}) => executeDelegateToolBlocks({
      ...getExecuteToolSet(),
      toolBlocks: [{ type: "tool_use", id: "delegate-shell", name: "shell",
        input: { command, timeout_ms: 999_999, stream_output: false, path: "allowed/decoy" },
      }],
      runnerContext: context,
      toolExecutionOptions: {
        resultLimit: 10000, verbose: false, autonomyMode: "autonomous",
        scopePolicy: policy(false), ...options,
      },
      mcpMgr: undefined, isExecute: true, messages: [],
      modifiedFiles: new Set(), urlsFetched: new Set(), searchQueries: new Set(),
    });
    const [success] = await invoke("printf review-ok");
    expect(success).toMatchObject({ content: "review-ok" });
    expect(success).not.toHaveProperty("is_error", true);
    for (const options of [{ scopePolicy: policy(true) }, { agentWriteScope: ["allowed/"] }]) {
      expect((await invoke("printf escaped > marker", options))[0]).toMatchObject({ is_error: true });
      expect(existsSync(join(root, "marker"))).toBe(false);
    }
    expect((await invoke("printf reviewed > marker", {
      autonomyMode: "supervised", approvalQueue: queue,
    }))[0]?.content).toContain("Queued for approval");
    const item = queue.list("pending")[0];
    if (!item) throw new Error("Expected delegated shell approval");
    const selection = queue.getExecutionSnapshot(item.id);
    if (!selection.ok) throw new Error("Expected execution snapshot");
    expect(selection.snapshot.executionInput.timeout_ms).toBe(60_000);
    const preflight = await prepareApprovalExecutionBatch([selection.snapshot], context);
    if (!preflight.ok) throw new Error("Expected delegated shell preflight");
    try {
      const lease = preflight.leases.get(item.id);
      if (!lease) throw new Error("Expected delegated shell lease");
      const approved = queue.approveForExecution(lease);
      if (!approved.ok) throw new Error("Expected delegated shell approval");
      expect(await approvedApprovalResponse(approved.approval, context, lease)).toMatchObject({
        resolution: { kind: "tool_execution", execution: { status: "succeeded" } },
      });
      expect(readFileSync(join(root, "marker"), "utf8")).toBe("reviewed");
    } finally {
      await closeApprovalExecutionLeases(preflight.leases.values());
    }
  } finally {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
});

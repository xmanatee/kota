import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApprovalQueue, resetApprovalQueue, setApprovalQueueInstance } from "#core/daemon/approval-queue.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { clearCustomTools, deregisterTool, type ToolRunnerContext } from "#core/tools/index.js";
import { captureLocalToolApprovalDeclaration } from "#core/tools/local-tool-approval-binding.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { resetPromptStore } from "#modules/prompt-templates/prompt.js";
import {
  approvalBatchDecisionBody,
  approvalDecisionBody,
  mockRequest,
  mockResponse,
} from "./approval-route-test-support.integration.js";

import {
  approvalScopeHasSqlite3 as hasSqlite3,
  makeApprovalScopeEntry as makeEntry,
  approvalScopePngBuffer as pngBuffer,
  REGISTERED_APPROVAL_SCOPE_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  registerApprovalScopeTools,
  registerApprovalScopeProvider as registerScopeQueueProvider,
  type ApprovalScopeRuntimeEntry as ScopeRuntimeEntry,
  APPROVAL_SCOPE_TOOL_NAMES as TOOL_NAMES,
  writeApprovalScopeFile as writeScopeFile,
  writeApprovalScopeSqlite as writeScopeSqlite,
} from "./execution-scope-tools.integration.js";

import { buildLocalApprovalsClient } from "./local-client.js";
import { handleApproveAllApprovals, handleApproveApproval, handleListApprovals } from "./routes.js";

function enqueueScopedTool(entry: ScopeRuntimeEntry, ...args: Parameters<ApprovalQueue["enqueue"]>) {
  args[10] = captureLocalToolApprovalDeclaration(args[0], args[1], {
    cwd: entry.scope.scopeRoot, scopeRoot: entry.scope.scopeRoot,
  });
  return entry.approvalQueue.enqueue(...args);
}

describe("approval execution scope", () => {
  let rootDir: string;
  let originalCwd: string;
  let defaultEntry: ScopeRuntimeEntry;
  let scopeB: ScopeRuntimeEntry;
  let contexts: ToolRunnerContext[];
  let toolOutputs: Array<{ tool: string; content: string }>;
  beforeEach(() => {
    originalCwd = process.cwd();
    rootDir = mkdtempSync(join(tmpdir(), "kota-approval-scope-"));
    resetProviderRegistry();
    resetApprovalQueue();
    contexts = [];
    toolOutputs = [];
    defaultEntry = makeEntry(join(rootDir, "scope-a"), "Scope A");
    scopeB = makeEntry(join(rootDir, "scope-b"), "Scope B");
    process.chdir(defaultEntry.scope.scopeRoot);
    registerScopeQueueProvider([defaultEntry, scopeB]);
    registerApprovalScopeTools(contexts, toolOutputs);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    for (const name of REGISTERED_TOOL_NAMES) deregisterTool(name);
    clearCustomTools();
    resetPromptStore();
    resetProviderRegistry();
    resetApprovalQueue();
    rmSync(rootDir, { recursive: true, force: true });
  });
  it("keeps concurrent scope approvals scoped through enqueue, listing, approval, and execution", async () => {
    setApprovalQueueInstance(scopeB.approvalQueue);

    const queueWrite = (entry: ScopeRuntimeEntry, sessionId: string, content: string) =>
      executeToolCalls(
        [
          {
            type: "tool_use",
            id: `tool-${sessionId}`,
            name: TOOL_NAMES.fileWrite,
            input: { path: "concurrent-marker.txt", content },
          },
        ],
        {
          resultLimit: 50_000,
          verbose: false,
          autonomyMode: "supervised",
          approvalQueue: entry.approvalQueue,
          cwd: entry.scope.scopeRoot,
          scopeRoot: entry.scope.scopeRoot,
          sessionId,
          scopeId: entry.scope.scopeId,
        },
      );

    await Promise.all([
      queueWrite(defaultEntry, "session-a", "scope-a"),
      queueWrite(scopeB, "session-b", "scope-b"),
    ]);

    const aListResponse = mockResponse();
    const bListResponse = mockResponse();
    await Promise.all([
      handleListApprovals(
        aListResponse.res,
        null,
        undefined,
        "pending",
        defaultEntry.scope.scopeId,
      ),
      handleListApprovals(bListResponse.res, null, undefined, "pending", scopeB.scope.scopeId),
    ]);

    const aApprovals = (
      aListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }
    ).approvals;
    const bApprovals = (
      bListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }
    ).approvals;
    expect(aApprovals).toHaveLength(1);
    expect(bApprovals).toHaveLength(1);
    expect(aApprovals[0]?.scopeId).toBe(defaultEntry.scope.scopeId);
    expect(bApprovals[0]?.scopeId).toBe(scopeB.scope.scopeId);

    const aApproveResponse = mockResponse();
    const bApproveResponse = mockResponse();
    await Promise.all([
      handleApproveApproval(
        mockRequest(approvalDecisionBody(defaultEntry.approvalQueue, aApprovals[0]!.id)),
        aApproveResponse.res,
        aApprovals[0]!.id,
        null,
        undefined,
        defaultEntry.scope.scopeId,
      ),
      handleApproveApproval(
        mockRequest(approvalDecisionBody(scopeB.approvalQueue, bApprovals[0]!.id)),
        bApproveResponse.res,
        bApprovals[0]!.id,
        null,
        undefined,
        scopeB.scope.scopeId,
      ),
    ]);

    expect(aApproveResponse.result.status).toBe(200);
    expect(bApproveResponse.result.status).toBe(200);
    expect(readFileSync(join(defaultEntry.scope.scopeRoot, "concurrent-marker.txt"), "utf-8")).toBe(
      "scope-a",
    );
    expect(readFileSync(join(scopeB.scope.scopeRoot, "concurrent-marker.txt"), "utf-8")).toBe(
      "scope-b",
    );
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cwd: defaultEntry.scope.scopeRoot,
          scopeId: defaultEntry.scope.scopeId,
          sessionId: "session-a",
        }),
        expect.objectContaining({
          cwd: scopeB.scope.scopeRoot,
          scopeId: scopeB.scope.scopeId,
          sessionId: "session-b",
        }),
      ]),
    );
  });

  it("rejects execution when a queued approval is attributed to another scope", async () => {
    const item = enqueueScopedTool(scopeB,
      TOOL_NAMES.fileWrite,
      { path: "scope-mismatch.txt", content: "must-not-run" },
      "moderate",
      "mismatched scope regression",
      undefined,
      undefined,
      undefined,
      undefined,
      "session-a",
    );
    const itemPath = join(scopeB.scope.scopeRoot, ".kota", "approvals", `${item.id}.json`);
    const stored = JSON.parse(readFileSync(itemPath, "utf-8")) as Record<string, unknown>;
    stored.scopeId = defaultEntry.scope.scopeId;
    writeFileSync(itemPath, JSON.stringify(stored, null, 2));
    expect(() => scopeB.approvalQueue.list("pending")).toThrow(/belongs to scope/);

    const { res, result } = mockResponse();
    await handleApproveApproval(
      mockRequest({ reviewDigest: "a".repeat(64) }),
      res,
      item.id,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      reason: "approval_scope_mismatch",
      expectedScopeId: scopeB.scope.scopeId,
    });
    expect(existsSync(join(scopeB.scope.scopeRoot, "scope-mismatch.txt"))).toBe(false);
    expect(scopeB.approvalQueue.get(item.id)?.status).toBe("pending");
  });

  it("executes a selected scope's single approval under that scope cwd", async () => {
    const item = enqueueScopedTool(scopeB,
      TOOL_NAMES.fileWrite,
      { path: "marker.txt", content: "scope-b" },
      "moderate",
      "write marker",
      undefined,
      undefined,
      undefined,
      undefined,
      "session-b",
    );

    const { res, result } = mockResponse();
    await handleApproveApproval(
      mockRequest(approvalDecisionBody(scopeB.approvalQueue, item.id)),
      res,
      item.id,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(200);
    expect(readFileSync(join(scopeB.scope.scopeRoot, "marker.txt"), "utf-8")).toBe("scope-b");
    expect(existsSync(join(defaultEntry.scope.scopeRoot, "marker.txt"))).toBe(false);
    expect(contexts[0]).toMatchObject({
      cwd: scopeB.scope.scopeRoot,
      scopeId: scopeB.scope.scopeId,
      sessionId: "session-b",
    });
  });

  it("executes approve-all for the selected scope without writing to the default scope", async () => {
    enqueueScopedTool(scopeB,
      TOOL_NAMES.fileWrite,
      { path: "one.txt", content: "one" },
      "moderate",
      "write one",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.fileWrite,
      { path: "nested/two.txt", content: "two" },
      "moderate",
      "write two",
    );
    const defaultItem = enqueueScopedTool(defaultEntry,
      TOOL_NAMES.fileWrite,
      { path: "default.txt", content: "default" },
      "moderate",
      "default write",
    );

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(approvalBatchDecisionBody(scopeB.approvalQueue)),
      res,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(200);
    expect(readFileSync(join(scopeB.scope.scopeRoot, "one.txt"), "utf-8")).toBe("one");
    expect(readFileSync(join(scopeB.scope.scopeRoot, "nested", "two.txt"), "utf-8")).toBe("two");
    expect(existsSync(join(defaultEntry.scope.scopeRoot, "one.txt"))).toBe(false);
    expect(existsSync(join(defaultEntry.scope.scopeRoot, "nested", "two.txt"))).toBe(false);
    expect(existsSync(join(defaultEntry.scope.scopeRoot, "default.txt"))).toBe(false);
    expect(defaultEntry.approvalQueue.get(defaultItem.id)?.status).toBe("pending");
    expect(contexts).toHaveLength(2);
    expect(contexts.every((context) => context.cwd === scopeB.scope.scopeRoot)).toBe(true);
  });

  it("executes selected scope relative read and search approvals without reading the default scope", async () => {
    writeScopeFile(defaultEntry, "readme.md", "# Default Scope\nDEFAULT_READ_MARKER\n");
    writeScopeFile(scopeB, "readme.md", "# Scope B\nSCOPE_B_READ_MARKER\n");

    writeScopeFile(defaultEntry, "searchable.txt", "DEFAULT_SEARCH_MARKER\n");
    writeScopeFile(scopeB, "searchable.txt", "SCOPE_B_SEARCH_MARKER\n");

    writeScopeFile(defaultEntry, "default-only.scope", "default glob marker\n");
    writeScopeFile(scopeB, "scope-b-only.scope", "scope-b glob marker\n");

    writeScopeFile(defaultEntry, "overview.md", "# Default Overview\n");
    writeScopeFile(scopeB, "overview.md", "# Scope B Overview\n");

    writeScopeFile(defaultEntry, "map.ts", "export const DEFAULT_SYMBOL = 'default';\n");
    writeScopeFile(scopeB, "map.ts", "export const SCOPE_B_SYMBOL = 'scope-b';\n");

    enqueueScopedTool(scopeB,
      TOOL_NAMES.fileRead,
      { path: "readme.md" },
      "safe",
      "read selected scope file",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.grep,
      { pattern: "SEARCH_MARKER", path: "." },
      "safe",
      "search selected scope files",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.glob,
      { pattern: "*.scope", path: "." },
      "safe",
      "glob selected scope files",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.filesOverview,
      { path: "." },
      "safe",
      "overview selected scope files",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.repoMap,
      { directory: ".", pattern: "**/*.ts" },
      "safe",
      "map selected scope source",
    );

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(approvalBatchDecisionBody(scopeB.approvalQueue)),
      res,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      resolutions: Array<{ resolution: { kind: string; execution: { status: string } } }>;
    };
    expect(
      body.resolutions.every(
        (entry) =>
          entry.resolution.kind === "tool_execution" &&
          entry.resolution.execution.status === "succeeded",
      ),
    ).toBe(true);
    const outputs = toolOutputs.map((entry) => entry.content);

    expect(outputs[0]).toContain("SCOPE_B_READ_MARKER");
    expect(outputs[0]).not.toContain("DEFAULT_READ_MARKER");
    expect(outputs[1]).toContain("SCOPE_B_SEARCH_MARKER");
    expect(outputs[1]).not.toContain("DEFAULT_SEARCH_MARKER");
    expect(outputs[2]).toContain("scope-b-only.scope");
    expect(outputs[2]).not.toContain("default-only.scope");
    expect(outputs[3]).toContain("# Scope B Overview");
    expect(outputs[3]).not.toContain("# Default Overview");
    expect(outputs[4]).toContain("SCOPE_B_SYMBOL");
    expect(outputs[4]).not.toContain("DEFAULT_SYMBOL");
    expect(contexts).toHaveLength(5);
    expect(contexts.every((context) => context.cwd === scopeB.scope.scopeRoot)).toBe(true);
  });

  it("executes selected scope relative document, image, sqlite, and prompt approvals without reading the default scope", async () => {
    writeScopeFile(defaultEntry, "docs/scope.html", "<p>DEFAULT_DOCUMENT_MARKER</p>");
    writeScopeFile(scopeB, "docs/scope.html", "<p>SCOPE_B_DOCUMENT_MARKER</p>");

    writeScopeFile(defaultEntry, "images/scope.png", pngBuffer(10, 10));
    writeScopeFile(scopeB, "images/scope.png", pngBuffer(20, 30));

    writeScopeFile(
      defaultEntry,
      ".kota/prompts/scope.md",
      "---\nname: scope\n---\nDEFAULT_PROMPT_MARKER",
    );
    writeScopeFile(
      scopeB,
      ".kota/prompts/scope.md",
      "---\nname: scope\n---\nSCOPE_B_PROMPT_MARKER",
    );

    if (hasSqlite3) {
      writeScopeSqlite(defaultEntry, "data/scope.db", "DEFAULT_SQLITE_MARKER");
      writeScopeSqlite(scopeB, "data/scope.db", "SCOPE_B_SQLITE_MARKER");
    }

    enqueueScopedTool(scopeB,
      TOOL_NAMES.readDocument,
      { path: "docs/scope.html" },
      "safe",
      "read selected scope document",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.viewImage,
      { path: "images/scope.png", detail: "original" },
      "safe",
      "view selected scope image",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.promptTemplate,
      { action: "render", name: "scope" },
      "safe",
      "render selected scope prompt",
    );
    if (hasSqlite3) {
      enqueueScopedTool(scopeB,
        TOOL_NAMES.sqlite,
        { database: "data/scope.db", action: "query", sql: "SELECT marker FROM markers" },
        "moderate",
        "query selected scope sqlite database",
      );
    }

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(approvalBatchDecisionBody(scopeB.approvalQueue)),
      res,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      resolutions: Array<{ resolution: { kind: string; execution: { status: string } } }>;
    };
    expect(
      body.resolutions.every(
        (entry) =>
          entry.resolution.kind === "tool_execution" &&
          entry.resolution.execution.status === "succeeded",
      ),
    ).toBe(true);
    const outputByTool = new Map(toolOutputs.map((entry) => [entry.tool, entry.content]));

    expect(outputByTool.get(TOOL_NAMES.readDocument)).toContain("SCOPE_B_DOCUMENT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.readDocument)).not.toContain("DEFAULT_DOCUMENT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.viewImage)).toContain("Original: 20x30px");
    expect(outputByTool.get(TOOL_NAMES.viewImage)).not.toContain("Original: 10x10px");
    expect(outputByTool.get(TOOL_NAMES.promptTemplate)).toContain("SCOPE_B_PROMPT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.promptTemplate)).not.toContain("DEFAULT_PROMPT_MARKER");
    if (hasSqlite3) {
      expect(outputByTool.get(TOOL_NAMES.sqlite)).toContain("SCOPE_B_SQLITE_MARKER");
      expect(outputByTool.get(TOOL_NAMES.sqlite)).not.toContain("DEFAULT_SQLITE_MARKER");
    }
    expect(contexts).toHaveLength(hasSqlite3 ? 4 : 3);
    expect(contexts.every((context) => context.cwd === scopeB.scope.scopeRoot)).toBe(true);
  });

  it("does not suggest default-scope files for selected scope read and edit misses", async () => {
    writeScopeFile(
      defaultEntry,
      "src/default-read-only.ts",
      "export const marker = 'default-read';\n",
    );
    writeScopeFile(
      defaultEntry,
      "src/default-edit-only.ts",
      "export const marker = 'default-edit';\n",
    );

    enqueueScopedTool(scopeB,
      TOOL_NAMES.fileRead,
      { path: "missing/default-read-only.ts" },
      "safe",
      "read missing selected scope file",
    );
    enqueueScopedTool(scopeB,
      TOOL_NAMES.fileEdit,
      {
        path: "missing/default-edit-only.ts",
        old_string: "default",
        new_string: "scope-b",
      },
      "moderate",
      "edit missing selected scope file",
    );

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(approvalBatchDecisionBody(scopeB.approvalQueue)),
      res,
      null,
      undefined,
      scopeB.scope.scopeId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      resolutions: Array<{ resolution: { kind: string; execution: { status: string } } }>;
    };
    expect(
      body.resolutions.every(
        (entry) =>
          entry.resolution.kind === "tool_execution" &&
          entry.resolution.execution.status === "failed",
      ),
    ).toBe(true);
    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0]?.content).toContain("Error: file not found:");
    expect(toolOutputs[0]?.content).not.toContain("Did you mean");
    expect(toolOutputs[0]?.content).not.toContain("Similar files found");
    expect(toolOutputs[0]?.content).not.toContain("src/default-read-only.ts");
    expect(toolOutputs[1]?.content).toContain("Error: file not found:");
    expect(toolOutputs[1]?.content).not.toContain("Did you mean");
    expect(toolOutputs[1]?.content).not.toContain("Similar files found");
    expect(toolOutputs[1]?.content).not.toContain("src/default-edit-only.ts");
    expect(contexts).toHaveLength(2);
    expect(contexts.every((context) => context.cwd === scopeB.scope.scopeRoot)).toBe(true);
  });

  it.each(["route", "local-client"])("resumes worktree module persistence through %s", async (surface) => {
    const worktree = join(scopeB.scope.scopeRoot, "worktree");
    mkdirSync(worktree);
    await executeToolCalls([{ type: "tool_use", id: "create-module", name: "module_factory", input:
      {
        action: "create",
        manifest: {
          name: "approval-scope-mod",
          description: "Approval scope regression module",
          tools: [
            {
              name: "approval_scope_manifest_tool",
              description: "Manifest tool",
              code: "print('manifest')",
            },
          ],
        },
      }
    }], {
      resultLimit: 10000, verbose: false, autonomyMode: "supervised",
      approvalQueue: scopeB.approvalQueue, cwd: worktree,
      scopeRoot: scopeB.scope.scopeRoot,
    });
    const pending = scopeB.approvalQueue.list("pending");
    expect(pending).toHaveLength(1);
    const item = pending[0]!;
    const review = scopeB.approvalQueue.projectForClient(item).review;
    if (review.status !== "available") throw new Error("Expected review");
    if (surface === "local-client") {
      expect(await buildLocalApprovalsClient().approve(item.id, review.digest, undefined, {
        scopeId: scopeB.scope.scopeId,
      })).toMatchObject({ ok: true, resolution: { kind: "tool_execution", execution: { status: "succeeded" } } });
    } else {
      const { res, result } = mockResponse();
      await handleApproveAllApprovals(
        mockRequest(approvalBatchDecisionBody(scopeB.approvalQueue)),
        res, null, undefined, scopeB.scope.scopeId,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ resolutions: [{ resolution: {
        kind: "tool_execution", execution: { status: "succeeded" },
      } }] });
    }
    expect(scopeB.approvalQueue.get(item.id)?.status).toBe("approved");
    expect(existsSync(join(scopeB.scope.scopeRoot, ".kota", "modules", "approval-scope-mod", "manifest.json"))).toBe(false);
    expect(
      existsSync(
        join(worktree, ".kota", "modules", "approval-scope-mod", "manifest.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          defaultEntry.scope.scopeRoot,
          ".kota",
          "modules",
          "approval-scope-mod",
          "manifest.json",
        ),
      ),
    ).toBe(false);

  });
});

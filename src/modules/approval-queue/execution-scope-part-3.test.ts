import { mkdtempSync, rmSync, } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ApprovalQueue,
  resetApprovalQueue,
} from "#core/daemon/approval-queue.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { resetCustomTools } from "#core/tools/custom-tool.js";
import {
  clearCustomTools,
  deregisterTool,
  type ToolRunnerContext,
} from "#core/tools/index.js";
import { resetModuleFactory } from "#core/tools/module-factory/index.js";
import { resetPromptStore } from "#modules/prompt-templates/prompt.js";
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
import {
  handleApproveAllApprovals,
} from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: () => {},
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: () => {},
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body));
  let dataHandler: ((chunk: Buffer) => void) | null = null;
  let endHandler: (() => void) | null = null;
  return {
    headers: { "content-type": "application/json" },
    on: (event: string, cb: (data?: Buffer) => void) => {
      if (event === "data") dataHandler = cb as (chunk: Buffer) => void;
      if (event === "end") endHandler = cb as () => void;
      if (dataHandler && endHandler) {
        dataHandler(buf);
        endHandler();
        dataHandler = null;
        endHandler = null;
      }
    },
  } as unknown as IncomingMessage;
}

function approvalDecisionBody(queue: ApprovalQueue, id: string): Record<string, unknown> {
  const item = queue.get(id);
  if (!item) throw new Error(`Missing approval ${id}`);
  const review = queue.projectForClient(item).review;
  if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
  return { reviewDigest: review.digest };
}

function approvalBatchDecisionBody(queue: ApprovalQueue): Record<string, unknown> {
  return {
    reviews: queue.list("pending").map((item) => ({
      id: item.id,
      digest: (approvalDecisionBody(queue, item.id).reviewDigest as string),
    })),
  };
}

describe("approval execution scope scope", () => {
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
    resetCustomTools();
    clearCustomTools();
    resetModuleFactory();
    resetPromptStore();
    resetProviderRegistry();
    resetApprovalQueue();
    rmSync(rootDir, { recursive: true, force: true });
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

    scopeB.approvalQueue.enqueue(
      TOOL_NAMES.readDocument,
      { path: "docs/scope.html" },
      "safe",
      "read selected scope document",
    );
    scopeB.approvalQueue.enqueue(
      TOOL_NAMES.viewImage,
      { path: "images/scope.png", detail: "original" },
      "safe",
      "view selected scope image",
    );
    scopeB.approvalQueue.enqueue(
      TOOL_NAMES.promptTemplate,
      { action: "render", name: "scope" },
      "safe",
      "render selected scope prompt",
    );
    if (hasSqlite3) {
      scopeB.approvalQueue.enqueue(
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
    expect(body.resolutions.every(
      (entry) =>
        entry.resolution.kind === "tool_execution"
        && entry.resolution.execution.status === "succeeded",
    )).toBe(true);
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
    writeScopeFile(defaultEntry, "src/default-read-only.ts", "export const marker = 'default-read';\n");
    writeScopeFile(defaultEntry, "src/default-edit-only.ts", "export const marker = 'default-edit';\n");

    scopeB.approvalQueue.enqueue(
      TOOL_NAMES.fileRead,
      { path: "missing/default-read-only.ts" },
      "safe",
      "read missing selected scope file",
    );
    scopeB.approvalQueue.enqueue(
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
    expect(body.resolutions.every(
      (entry) =>
        entry.resolution.kind === "tool_execution"
        && entry.resolution.execution.status === "failed",
    )).toBe(true);
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
  });});

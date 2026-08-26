import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { resetCustomTools } from "#core/tools/custom-tool.js";
import {
  clearCustomTools,
  deregisterTool,
  type ToolRunnerContext,
} from "#core/tools/index.js";
import { resetModuleFactory } from "#core/tools/module-factory/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { resetPromptStore } from "#modules/prompt-templates/prompt.js";
import {
  makeApprovalScopeEntry as makeEntry,
  REGISTERED_APPROVAL_SCOPE_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  registerApprovalScopeTools,
  registerApprovalScopeProvider as registerScopeQueueProvider,
  type ApprovalScopeRuntimeEntry as ScopeRuntimeEntry,
  APPROVAL_SCOPE_TOOL_NAMES as TOOL_NAMES,
} from "./execution-scope-tools.integration.js";
import {
  handleApproveApproval,
  handleListApprovals,
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

  it("keeps concurrent scope approvals scoped through enqueue, listing, approval, and execution", async () => {
    setApprovalQueueInstance(scopeB.approvalQueue);

    const queueWrite = (
      entry: ScopeRuntimeEntry,
      sessionId: string,
      content: string,
    ) => executeToolCalls(
      [{
        type: "tool_use",
        id: `tool-${sessionId}`,
        name: TOOL_NAMES.fileWrite,
        input: { path: "concurrent-marker.txt", content },
      }],
      {
        resultLimit: 50_000,
        verbose: false,
        autonomyMode: "supervised",
        approvalQueue: entry.approvalQueue,
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
      handleListApprovals(
        bListResponse.res,
        null,
        undefined,
        "pending",
        scopeB.scope.scopeId,
      ),
    ]);

    const aApprovals = (aListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }).approvals;
    const bApprovals = (bListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }).approvals;
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
    expect(readFileSync(join(defaultEntry.scope.scopeRoot, "concurrent-marker.txt"), "utf-8"))
      .toBe("scope-a");
    expect(readFileSync(join(scopeB.scope.scopeRoot, "concurrent-marker.txt"), "utf-8"))
      .toBe("scope-b");
    expect(contexts).toEqual(expect.arrayContaining([
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
    ]));
  });

  it("rejects execution when a queued approval is attributed to another scope", async () => {
    const item = scopeB.approvalQueue.enqueue(
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
    const itemPath = join(
      scopeB.scope.scopeRoot,
      ".kota",
      "approvals",
      `${item.id}.json`,
    );
    const stored = JSON.parse(readFileSync(itemPath, "utf-8")) as Record<string, unknown>;
    stored.scopeId = defaultEntry.scope.scopeId;
    writeFileSync(itemPath, JSON.stringify(stored, null, 2));
    expect(() => scopeB.approvalQueue.list("pending")).toThrow(
      /belongs to scope/,
    );

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
  });});

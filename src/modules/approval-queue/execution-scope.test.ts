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
  type ApprovalScopeProjectRuntimeEntry as ProjectRuntimeEntry,
  REGISTERED_APPROVAL_SCOPE_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  registerApprovalScopeTools,
  registerApprovalScopeProjectProvider as registerProjectQueueProvider,
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

describe("approval execution project scope", () => {
  let rootDir: string;
  let originalCwd: string;
  let defaultEntry: ProjectRuntimeEntry;
  let projectB: ProjectRuntimeEntry;
  let contexts: ToolRunnerContext[];
  let toolOutputs: Array<{ tool: string; content: string }>;

  beforeEach(() => {
    originalCwd = process.cwd();
    rootDir = mkdtempSync(join(tmpdir(), "kota-approval-scope-"));
    resetProviderRegistry();
    resetApprovalQueue();
    contexts = [];
    toolOutputs = [];
    defaultEntry = makeEntry(join(rootDir, "project-a"), "Project A");
    projectB = makeEntry(join(rootDir, "project-b"), "Project B");
    process.chdir(defaultEntry.project.projectDir);
    registerProjectQueueProvider([defaultEntry, projectB]);
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

  it("keeps concurrent project approvals scoped through enqueue, listing, approval, and execution", async () => {
    setApprovalQueueInstance(projectB.approvalQueue);

    const queueWrite = (
      entry: ProjectRuntimeEntry,
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
        scopeId: entry.project.projectId,
        projectId: entry.project.projectId,
      },
    );

    await Promise.all([
      queueWrite(defaultEntry, "session-a", "project-a"),
      queueWrite(projectB, "session-b", "project-b"),
    ]);

    const aListResponse = mockResponse();
    const bListResponse = mockResponse();
    await Promise.all([
      handleListApprovals(
        aListResponse.res,
        null,
        undefined,
        "pending",
        defaultEntry.project.projectId,
      ),
      handleListApprovals(
        bListResponse.res,
        null,
        undefined,
        "pending",
        projectB.project.projectId,
      ),
    ]);

    const aApprovals = (aListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }).approvals;
    const bApprovals = (bListResponse.result.body as { approvals: Array<{ id: string; scopeId: string }> }).approvals;
    expect(aApprovals).toHaveLength(1);
    expect(bApprovals).toHaveLength(1);
    expect(aApprovals[0]?.scopeId).toBe(defaultEntry.project.projectId);
    expect(bApprovals[0]?.scopeId).toBe(projectB.project.projectId);

    const aApproveResponse = mockResponse();
    const bApproveResponse = mockResponse();
    await Promise.all([
      handleApproveApproval(
        mockRequest(approvalDecisionBody(defaultEntry.approvalQueue, aApprovals[0]!.id)),
        aApproveResponse.res,
        aApprovals[0]!.id,
        null,
        undefined,
        defaultEntry.project.projectId,
      ),
      handleApproveApproval(
        mockRequest(approvalDecisionBody(projectB.approvalQueue, bApprovals[0]!.id)),
        bApproveResponse.res,
        bApprovals[0]!.id,
        null,
        undefined,
        projectB.project.projectId,
      ),
    ]);

    expect(aApproveResponse.result.status).toBe(200);
    expect(bApproveResponse.result.status).toBe(200);
    expect(readFileSync(join(defaultEntry.project.projectDir, "concurrent-marker.txt"), "utf-8"))
      .toBe("project-a");
    expect(readFileSync(join(projectB.project.projectDir, "concurrent-marker.txt"), "utf-8"))
      .toBe("project-b");
    expect(contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cwd: defaultEntry.project.projectDir,
        scopeId: defaultEntry.project.projectId,
        sessionId: "session-a",
      }),
      expect.objectContaining({
        cwd: projectB.project.projectDir,
        scopeId: projectB.project.projectId,
        sessionId: "session-b",
      }),
    ]));
  });

  it("rejects execution when a queued approval is attributed to another project", async () => {
    const item = projectB.approvalQueue.enqueue(
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
      projectB.project.projectDir,
      ".kota",
      "approvals",
      `${item.id}.json`,
    );
    const stored = JSON.parse(readFileSync(itemPath, "utf-8")) as Record<string, unknown>;
    stored.scopeId = defaultEntry.project.projectId;
    writeFileSync(itemPath, JSON.stringify(stored, null, 2));
    expect(() => projectB.approvalQueue.list("pending")).toThrow(
      /belongs to scope/,
    );

    const { res, result } = mockResponse();
    await handleApproveApproval(
      mockRequest({ reviewDigest: "a".repeat(64) }),
      res,
      item.id,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      reason: "approval_scope_mismatch",
      expectedScopeId: projectB.project.projectId,
    });
    expect(existsSync(join(projectB.project.projectDir, "scope-mismatch.txt"))).toBe(false);
    expect(projectB.approvalQueue.get(item.id)?.status).toBe("pending");
  });});

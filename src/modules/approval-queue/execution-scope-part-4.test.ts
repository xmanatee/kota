import { existsSync, mkdtempSync, rmSync, } from "node:fs";
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
  makeApprovalScopeEntry as makeEntry,
  REGISTERED_APPROVAL_SCOPE_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  registerApprovalScopeTools,
  registerApprovalScopeProvider as registerScopeQueueProvider,
  type ApprovalScopeRuntimeEntry as ScopeRuntimeEntry,
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

  it("executes approved module and custom-tool persistence under the selected scope cwd", async () => {
    scopeB.approvalQueue.enqueue(
      "module_factory",
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
      },
      "moderate",
      "create selected scope manifest module",
    );
    scopeB.approvalQueue.enqueue(
      "custom_tool",
      {
        action: "create",
        name: "approval_scope_custom_tool",
        description: "Approval scope regression custom tool",
        code: "print('custom')",
        persist: true,
      },
      "moderate",
      "create selected scope custom tool",
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
        && entry.resolution.execution.status === "succeeded",
    )).toBe(true);
    expect(existsSync(
      join(scopeB.scope.scopeRoot, ".kota", "modules", "approval-scope-mod", "manifest.json"),
    )).toBe(true);
    expect(existsSync(
      join(defaultEntry.scope.scopeRoot, ".kota", "modules", "approval-scope-mod", "manifest.json"),
    )).toBe(false);
    expect(existsSync(
      join(scopeB.scope.scopeRoot, ".kota", "tools", "approval_scope_custom_tool.json"),
    )).toBe(true);
    expect(existsSync(
      join(defaultEntry.scope.scopeRoot, ".kota", "tools", "approval_scope_custom_tool.json"),
    )).toBe(false);
  });});

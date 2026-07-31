import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  approvalScopeHasSqlite3 as hasSqlite3,
  makeApprovalScopeEntry as makeEntry,
  type ApprovalScopeProjectRuntimeEntry as ProjectRuntimeEntry,
  approvalScopePngBuffer as pngBuffer,
  REGISTERED_APPROVAL_SCOPE_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  registerApprovalScopeTools,
  registerApprovalScopeProjectProvider as registerProjectQueueProvider,
  APPROVAL_SCOPE_TOOL_NAMES as TOOL_NAMES,
  writeApprovalScopeProjectFile as writeProjectFile,
  writeApprovalScopeSqlite as writeProjectSqlite,
} from "./execution-scope-tools.integration.js";
import {
  handleApproveAllApprovals,
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

function approvalBatchDecisionBody(queue: ApprovalQueue): Record<string, unknown> {
  return {
    reviews: queue.list("pending").map((item) => ({
      id: item.id,
      digest: (approvalDecisionBody(queue, item.id).reviewDigest as string),
    })),
  };
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
    mkdirSync(defaultEntry.project.projectDir, { recursive: true });
    mkdirSync(projectB.project.projectDir, { recursive: true });
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

  it("executes approved module and custom-tool persistence under the selected project cwd", async () => {
    projectB.approvalQueue.enqueue(
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
      "create selected project manifest module",
    );
    projectB.approvalQueue.enqueue(
      "custom_tool",
      {
        action: "create",
        name: "approval_scope_custom_tool",
        description: "Approval scope regression custom tool",
        code: "print('custom')",
        persist: true,
      },
      "moderate",
      "create selected project custom tool",
    );

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(approvalBatchDecisionBody(projectB.approvalQueue)),
      res,
      null,
      undefined,
      projectB.project.projectId,
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
      join(projectB.project.projectDir, ".kota", "modules", "approval-scope-mod", "manifest.json"),
    )).toBe(true);
    expect(existsSync(
      join(defaultEntry.project.projectDir, ".kota", "modules", "approval-scope-mod", "manifest.json"),
    )).toBe(false);
    expect(existsSync(
      join(projectB.project.projectDir, ".kota", "tools", "approval_scope_custom_tool.json"),
    )).toBe(true);
    expect(existsSync(
      join(defaultEntry.project.projectDir, ".kota", "tools", "approval_scope_custom_tool.json"),
    )).toBe(false);
  });});

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

  it("executes a selected project's single approval under that project cwd", async () => {
    const item = projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileWrite,
      { path: "marker.txt", content: "project-b" },
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
      mockRequest(approvalDecisionBody(projectB.approvalQueue, item.id)),
      res,
      item.id,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(200);
    expect(readFileSync(join(projectB.project.projectDir, "marker.txt"), "utf-8")).toBe("project-b");
    expect(existsSync(join(defaultEntry.project.projectDir, "marker.txt"))).toBe(false);
    expect(contexts[0]).toMatchObject({
      cwd: projectB.project.projectDir,
      scopeId: projectB.project.projectId,
      projectId: projectB.project.projectId,
      sessionId: "session-b",
    });
  });

  it("executes approve-all for the selected project without writing to the default project", async () => {
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileWrite,
      { path: "one.txt", content: "one" },
      "moderate",
      "write one",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileWrite,
      { path: "nested/two.txt", content: "two" },
      "moderate",
      "write two",
    );
    const defaultItem = defaultEntry.approvalQueue.enqueue(
      TOOL_NAMES.fileWrite,
      { path: "default.txt", content: "default" },
      "moderate",
      "default write",
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
    expect(readFileSync(join(projectB.project.projectDir, "one.txt"), "utf-8")).toBe("one");
    expect(readFileSync(join(projectB.project.projectDir, "nested", "two.txt"), "utf-8")).toBe("two");
    expect(existsSync(join(defaultEntry.project.projectDir, "one.txt"))).toBe(false);
    expect(existsSync(join(defaultEntry.project.projectDir, "nested", "two.txt"))).toBe(false);
    expect(existsSync(join(defaultEntry.project.projectDir, "default.txt"))).toBe(false);
    expect(defaultEntry.approvalQueue.get(defaultItem.id)?.status).toBe("pending");
    expect(contexts).toHaveLength(2);
    expect(contexts.every((context) => context.cwd === projectB.project.projectDir)).toBe(true);
  });

  it("executes selected project relative read and search approvals without reading the default project", async () => {
    writeProjectFile(defaultEntry, "readme.md", "# Default Project\nDEFAULT_READ_MARKER\n");
    writeProjectFile(projectB, "readme.md", "# Project B\nPROJECT_B_READ_MARKER\n");

    writeProjectFile(defaultEntry, "searchable.txt", "DEFAULT_SEARCH_MARKER\n");
    writeProjectFile(projectB, "searchable.txt", "PROJECT_B_SEARCH_MARKER\n");

    writeProjectFile(defaultEntry, "default-only.scope", "default glob marker\n");
    writeProjectFile(projectB, "project-b-only.scope", "project-b glob marker\n");

    writeProjectFile(defaultEntry, "overview.md", "# Default Overview\n");
    writeProjectFile(projectB, "overview.md", "# Project B Overview\n");

    writeProjectFile(defaultEntry, "map.ts", "export const DEFAULT_SYMBOL = 'default';\n");
    writeProjectFile(projectB, "map.ts", "export const PROJECT_B_SYMBOL = 'project-b';\n");

    projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileRead,
      { path: "readme.md" },
      "safe",
      "read selected project file",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.grep,
      { pattern: "SEARCH_MARKER", path: "." },
      "safe",
      "search selected project files",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.glob,
      { pattern: "*.scope", path: "." },
      "safe",
      "glob selected project files",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.filesOverview,
      { path: "." },
      "safe",
      "overview selected project files",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.repoMap,
      { directory: ".", pattern: "**/*.ts" },
      "safe",
      "map selected project source",
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
    const outputs = toolOutputs.map((entry) => entry.content);

    expect(outputs[0]).toContain("PROJECT_B_READ_MARKER");
    expect(outputs[0]).not.toContain("DEFAULT_READ_MARKER");
    expect(outputs[1]).toContain("PROJECT_B_SEARCH_MARKER");
    expect(outputs[1]).not.toContain("DEFAULT_SEARCH_MARKER");
    expect(outputs[2]).toContain("project-b-only.scope");
    expect(outputs[2]).not.toContain("default-only.scope");
    expect(outputs[3]).toContain("# Project B Overview");
    expect(outputs[3]).not.toContain("# Default Overview");
    expect(outputs[4]).toContain("PROJECT_B_SYMBOL");
    expect(outputs[4]).not.toContain("DEFAULT_SYMBOL");
    expect(contexts).toHaveLength(5);
    expect(contexts.every((context) => context.cwd === projectB.project.projectDir)).toBe(true);
  });});

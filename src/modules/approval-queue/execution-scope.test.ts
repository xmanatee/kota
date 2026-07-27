import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
} from "#core/daemon/scope-registry.js";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { resetCustomTools } from "#core/tools/custom-tool.js";
import {
  clearCustomTools,
  deregisterTool,
  registerTool,
  type ToolResult,
  type ToolRunnerContext,
} from "#core/tools/index.js";
import { resetModuleFactory } from "#core/tools/module-factory/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { fileEditTool, runFileEdit } from "#modules/filesystem/file-edit.js";
import { fileReadTool, runFileRead } from "#modules/filesystem/file-read.js";
import { fileWriteTool, runFileWrite } from "#modules/filesystem/file-write.js";
import { filesOverviewTool, runFilesOverview } from "#modules/filesystem/files-overview.js";
import { globTool, runGlob } from "#modules/filesystem/glob.js";
import { grepTool, runGrep } from "#modules/filesystem/grep.js";
import { repoMapTool, runRepoMap } from "#modules/filesystem/repo-map.js";
import { promptTool, resetPromptStore, runPromptTemplate } from "#modules/prompt-templates/prompt.js";
import { readDocumentTool, runReadDocument } from "#modules/read-document/read-document.js";
import { runSqlite, sqliteTool } from "#modules/system/sqlite.js";
import { runViewImage, viewImageTool } from "#modules/system/view-image.js";
import {
  handleApproveAllApprovals,
  handleApproveApproval,
  handleListApprovals,
} from "./routes.js";

let hasSqlite3 = false;
try {
  execFileSync("sqlite3", ["--version"], { timeout: 5000, stdio: "ignore" });
  hasSqlite3 = true;
} catch {
  // sqlite3 is optional on developer machines.
}

const TOOL_NAMES = {
  fileWrite: "approval_scope_file_write",
  fileEdit: "approval_scope_file_edit",
  fileRead: "approval_scope_file_read",
  glob: "approval_scope_glob",
  grep: "approval_scope_grep",
  filesOverview: "approval_scope_files_overview",
  repoMap: "approval_scope_repo_map",
  readDocument: "approval_scope_read_document",
  viewImage: "approval_scope_view_image",
  sqlite: "approval_scope_sqlite",
  promptTemplate: "approval_scope_prompt_template",
} as const;

const REGISTERED_TOOL_NAMES = Object.values(TOOL_NAMES);

type ProjectRuntimeEntry = {
  project: ConfiguredProject;
  approvalQueue: ApprovalQueue;
  ownerDecisionStore: OwnerDecisionStore;
  ownerQuestionQueue: OwnerQuestionQueue;
};

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

function makeEntry(projectDir: string, displayName: string): ProjectRuntimeEntry {
  const project = buildConfiguredProject({ projectDir, displayName });
  return {
    project,
    approvalQueue: new ApprovalQueue(
      join(project.projectDir, ".kota", "approvals"),
      null,
      project.projectId,
    ),
    ownerDecisionStore: new OwnerDecisionStore(
      join(project.projectDir, ".kota", "owner-decisions"),
      project.projectId,
    ),
    ownerQuestionQueue: new OwnerQuestionQueue(join(project.projectDir, ".kota", "owner-questions")),
  };
}

function registerProjectQueueProvider(entries: ProjectRuntimeEntry[]): void {
  const defaultEntry = entries[0];
  if (!defaultEntry) throw new Error("expected at least one project");
  const byId = new Map(entries.map((entry) => [entry.project.projectId, entry]));
  const registry = initProviderRegistry();
  registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
    getProjectRegistryProjection: () => ({
      defaultProjectId: defaultEntry.project.projectId,
      projects: entries.map((entry) => entry.project),
    }),
    getActiveProjectId: () => null,
    resolveProjectRuntime: (projectId) => {
      const selected = projectId?.trim() || defaultEntry.project.projectId;
      const entry = byId.get(selected);
      if (!entry) {
        return {
          ok: false,
          error: {
            error: "Unknown project",
            reason: "unknown_project",
            projectId: selected,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          project: entry.project,
          approvalQueue: entry.approvalQueue,
          secretStore: {} as never,
          ownerDecisionStore: entry.ownerDecisionStore,
          ownerQuestionQueue: entry.ownerQuestionQueue,
        },
      };
    },
  });
}

function writeProjectFile(
  entry: ProjectRuntimeEntry,
  relativePath: string,
  content: string | Buffer,
): void {
  const path = join(entry.project.projectDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function writeProjectSqlite(
  entry: ProjectRuntimeEntry,
  relativePath: string,
  marker: string,
): void {
  const path = join(entry.project.projectDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("sqlite3", [
    path,
    `CREATE TABLE markers (marker TEXT); INSERT INTO markers VALUES ('${marker}');`,
  ]);
}

describe("approval execution project scope", () => {
  let rootDir: string;
  let originalCwd: string;
  let defaultEntry: ProjectRuntimeEntry;
  let projectB: ProjectRuntimeEntry;
  let contexts: ToolRunnerContext[];
  let toolOutputs: Array<{ tool: string; content: string }>;

  function recordToolOutput(tool: string, result: ToolResult): ToolResult {
    toolOutputs.push({ tool, content: result.content });
    return result;
  }

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
    for (const name of REGISTERED_TOOL_NAMES) deregisterTool(name);
    registerTool(
      { ...fileWriteTool, name: TOOL_NAMES.fileWrite },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.fileWrite, await runFileWrite(input, context));
      },
    );
    registerTool(
      { ...fileEditTool, name: TOOL_NAMES.fileEdit },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.fileEdit, await runFileEdit(input, context));
      },
    );
    registerTool(
      { ...fileReadTool, name: TOOL_NAMES.fileRead },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.fileRead, await runFileRead(input, context));
      },
    );
    registerTool(
      { ...globTool, name: TOOL_NAMES.glob },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.glob, await runGlob(input, context));
      },
    );
    registerTool(
      { ...grepTool, name: TOOL_NAMES.grep },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.grep, await runGrep(input, context));
      },
    );
    registerTool(
      { ...filesOverviewTool, name: TOOL_NAMES.filesOverview },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.filesOverview, await runFilesOverview(input, context));
      },
    );
    registerTool(
      { ...repoMapTool, name: TOOL_NAMES.repoMap },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.repoMap, await runRepoMap(input, context));
      },
    );
    registerTool(
      { ...readDocumentTool, name: TOOL_NAMES.readDocument },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.readDocument, await runReadDocument(input, context));
      },
    );
    registerTool(
      { ...viewImageTool, name: TOOL_NAMES.viewImage },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.viewImage, await runViewImage(input, context));
      },
    );
    registerTool(
      { ...sqliteTool, name: TOOL_NAMES.sqlite },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.sqlite, await runSqlite(input, context));
      },
    );
    registerTool(
      { ...promptTool, name: TOOL_NAMES.promptTemplate },
      async (input, context) => {
        contexts.push(context ?? {});
        return recordToolOutput(TOOL_NAMES.promptTemplate, await runPromptTemplate(input, context));
      },
    );
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
        mockRequest(),
        aApproveResponse.res,
        aApprovals[0]!.id,
        null,
        undefined,
        defaultEntry.project.projectId,
      ),
      handleApproveApproval(
        mockRequest(),
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
      mockRequest(),
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
      mockRequest(),
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
      mockRequest(),
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
      mockRequest(),
      res,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      executions: Array<{ execution: { status: string } }>;
    };
    expect(body.executions.every((entry) => entry.execution.status === "succeeded")).toBe(true);
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
  });

  it("executes selected project relative document, image, sqlite, and prompt approvals without reading the default project", async () => {
    writeProjectFile(defaultEntry, "docs/scope.html", "<p>DEFAULT_DOCUMENT_MARKER</p>");
    writeProjectFile(projectB, "docs/scope.html", "<p>PROJECT_B_DOCUMENT_MARKER</p>");

    writeProjectFile(defaultEntry, "images/scope.png", pngBuffer(10, 10));
    writeProjectFile(projectB, "images/scope.png", pngBuffer(20, 30));

    writeProjectFile(
      defaultEntry,
      ".kota/prompts/scope.md",
      "---\nname: scope\n---\nDEFAULT_PROMPT_MARKER",
    );
    writeProjectFile(
      projectB,
      ".kota/prompts/scope.md",
      "---\nname: scope\n---\nPROJECT_B_PROMPT_MARKER",
    );

    if (hasSqlite3) {
      writeProjectSqlite(defaultEntry, "data/scope.db", "DEFAULT_SQLITE_MARKER");
      writeProjectSqlite(projectB, "data/scope.db", "PROJECT_B_SQLITE_MARKER");
    }

    projectB.approvalQueue.enqueue(
      TOOL_NAMES.readDocument,
      { path: "docs/scope.html" },
      "safe",
      "read selected project document",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.viewImage,
      { path: "images/scope.png", detail: "original" },
      "safe",
      "view selected project image",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.promptTemplate,
      { action: "render", name: "scope" },
      "safe",
      "render selected project prompt",
    );
    if (hasSqlite3) {
      projectB.approvalQueue.enqueue(
        TOOL_NAMES.sqlite,
        { database: "data/scope.db", action: "query", sql: "SELECT marker FROM markers" },
        "moderate",
        "query selected project sqlite database",
      );
    }

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(),
      res,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      executions: Array<{ execution: { status: string } }>;
    };
    expect(body.executions.every((entry) => entry.execution.status === "succeeded")).toBe(true);
    const outputByTool = new Map(toolOutputs.map((entry) => [entry.tool, entry.content]));

    expect(outputByTool.get(TOOL_NAMES.readDocument)).toContain("PROJECT_B_DOCUMENT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.readDocument)).not.toContain("DEFAULT_DOCUMENT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.viewImage)).toContain("Original: 20x30px");
    expect(outputByTool.get(TOOL_NAMES.viewImage)).not.toContain("Original: 10x10px");
    expect(outputByTool.get(TOOL_NAMES.promptTemplate)).toContain("PROJECT_B_PROMPT_MARKER");
    expect(outputByTool.get(TOOL_NAMES.promptTemplate)).not.toContain("DEFAULT_PROMPT_MARKER");
    if (hasSqlite3) {
      expect(outputByTool.get(TOOL_NAMES.sqlite)).toContain("PROJECT_B_SQLITE_MARKER");
      expect(outputByTool.get(TOOL_NAMES.sqlite)).not.toContain("DEFAULT_SQLITE_MARKER");
    }
    expect(contexts).toHaveLength(hasSqlite3 ? 4 : 3);
    expect(contexts.every((context) => context.cwd === projectB.project.projectDir)).toBe(true);
  });

  it("does not suggest default-project files for selected project read and edit misses", async () => {
    writeProjectFile(defaultEntry, "src/default-read-only.ts", "export const marker = 'default-read';\n");
    writeProjectFile(defaultEntry, "src/default-edit-only.ts", "export const marker = 'default-edit';\n");

    projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileRead,
      { path: "missing/default-read-only.ts" },
      "safe",
      "read missing selected project file",
    );
    projectB.approvalQueue.enqueue(
      TOOL_NAMES.fileEdit,
      {
        path: "missing/default-edit-only.ts",
        old_string: "default",
        new_string: "project-b",
      },
      "moderate",
      "edit missing selected project file",
    );

    const { res, result } = mockResponse();
    await handleApproveAllApprovals(
      mockRequest(),
      res,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      executions: Array<{ execution: { status: string } }>;
    };
    expect(body.executions.every((entry) => entry.execution.status === "failed")).toBe(true);
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
    expect(contexts.every((context) => context.cwd === projectB.project.projectDir)).toBe(true);
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
      mockRequest(),
      res,
      null,
      undefined,
      projectB.project.projectId,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      executions: Array<{ execution: { status: string } }>;
    };
    expect(body.executions.every((entry) => entry.execution.status === "succeeded")).toBe(true);
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
  });
});

import {
  deregisterTool,
  registerTool,
  type ToolResult,
  type ToolRunnerContext,
} from "#core/tools/index.js";
import { fileEditTool, runFileEdit } from "#modules/filesystem/file-edit.js";
import { fileReadTool, runFileRead } from "#modules/filesystem/file-read.js";
import { fileWriteTool, runFileWrite } from "#modules/filesystem/file-write.js";
import { filesOverviewTool, runFilesOverview } from "#modules/filesystem/files-overview.js";
import { globTool, runGlob } from "#modules/filesystem/glob.js";
import { grepTool, runGrep } from "#modules/filesystem/grep.js";
import { repoMapTool, runRepoMap } from "#modules/filesystem/repo-map.js";
import { promptTool, runPromptTemplate } from "#modules/prompt-templates/prompt.js";
import { readDocumentTool, runReadDocument } from "#modules/read-document/read-document.js";
import { runSqlite, sqliteTool } from "#modules/system/sqlite.js";
import { runViewImage, viewImageTool } from "#modules/system/view-image.js";

export const APPROVAL_SCOPE_TOOL_NAMES = {
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

export const REGISTERED_APPROVAL_SCOPE_TOOL_NAMES = Object.values(APPROVAL_SCOPE_TOOL_NAMES);

export type ApprovalScopeRuntimeEntry = {
  scope: DirectoryScope;
  approvalQueue: ApprovalQueue;
  ownerDecisionStore: OwnerDecisionStore;
  ownerQuestionQueue: OwnerQuestionQueue;
};

export const approvalScopeHasSqlite3 = (() => {
  try {
    execFileSync("sqlite3", ["--version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export function makeApprovalScopeEntry(
  scopeRoot: string,
  displayName: string,
): ApprovalScopeRuntimeEntry {
  mkdirSync(scopeRoot, { recursive: true });
  const scope = buildDirectoryScope({ scopeRoot, displayName });
  return {
    scope,
    approvalQueue: new ApprovalQueue(
      join(scope.scopeRoot, ".kota", "approvals"),
      null,
      { scopeId: scope.scopeId },
    ),
    ownerDecisionStore: new OwnerDecisionStore(
      join(scope.scopeRoot, ".kota", "owner-decisions"),
      scope.scopeId,
    ),
    ownerQuestionQueue: new OwnerQuestionQueue(join(scope.scopeRoot, ".kota", "owner-questions")),
  };
}

export function registerApprovalScopeProvider(
  entries: ApprovalScopeRuntimeEntry[],
): void {
  const defaultEntry = entries[0];
  if (!defaultEntry) throw new Error("expected at least one scope");
  const byId = new Map(entries.map((entry) => [entry.scope.scopeId, entry]));
  initProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "test", {
    getScopeRegistryProjection: () => buildScopeRegistryProjection(
      defaultEntry.scope.scopeId,
      entries.map((entry) => entry.scope),
    ),
    getActiveScopeId: () => null,
    resolveScopeRuntime: (scopeId) => {
      const selected = scopeId?.trim() || defaultEntry.scope.scopeId;
      const entry = byId.get(selected);
      if (!entry) {
        return {
          ok: false,
          error: { error: "Unknown scope", reason: "unknown_scope", scopeId: selected },
        };
      }
      return {
        ok: true,
        runtime: {
          scope: entry.scope,
          approvalQueue: entry.approvalQueue,
          secretStore: {} as never,
          ownerDecisionStore: entry.ownerDecisionStore,
          ownerQuestionQueue: entry.ownerQuestionQueue,
        },
      };
    },
  });
}

export function writeApprovalScopeFile(
  entry: ApprovalScopeRuntimeEntry,
  relativePath: string,
  content: string | Buffer,
): void {
  const path = join(entry.scope.scopeRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function approvalScopePngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

export function writeApprovalScopeSqlite(
  entry: ApprovalScopeRuntimeEntry,
  relativePath: string,
  marker: string,
): void {
  const path = join(entry.scope.scopeRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("sqlite3", [
    path,
    `CREATE TABLE markers (marker TEXT); INSERT INTO markers VALUES ('${marker}');`,
  ]);
}

export function registerApprovalScopeTools(
  contexts: ToolRunnerContext[],
  toolOutputs: Array<{ tool: string; content: string }>,
): void {
  const record = (tool: string, result: ToolResult): ToolResult => {
    toolOutputs.push({ tool, content: result.content });
    return result;
  };

  for (const name of REGISTERED_APPROVAL_SCOPE_TOOL_NAMES) deregisterTool(name);
  registerTool(
    { ...fileWriteTool, name: APPROVAL_SCOPE_TOOL_NAMES.fileWrite },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.fileWrite, await runFileWrite(input, context));
    },
  );
  registerTool(
    { ...fileEditTool, name: APPROVAL_SCOPE_TOOL_NAMES.fileEdit },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.fileEdit, await runFileEdit(input, context));
    },
  );
  registerTool(
    { ...fileReadTool, name: APPROVAL_SCOPE_TOOL_NAMES.fileRead },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.fileRead, await runFileRead(input, context));
    },
  );
  registerTool(
    { ...globTool, name: APPROVAL_SCOPE_TOOL_NAMES.glob },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.glob, await runGlob(input, context));
    },
  );
  registerTool(
    { ...grepTool, name: APPROVAL_SCOPE_TOOL_NAMES.grep },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.grep, await runGrep(input, context));
    },
  );
  registerTool(
    { ...filesOverviewTool, name: APPROVAL_SCOPE_TOOL_NAMES.filesOverview },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(
        APPROVAL_SCOPE_TOOL_NAMES.filesOverview,
        await runFilesOverview(input, context),
      );
    },
  );
  registerTool(
    { ...repoMapTool, name: APPROVAL_SCOPE_TOOL_NAMES.repoMap },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.repoMap, await runRepoMap(input, context));
    },
  );
  registerTool(
    { ...readDocumentTool, name: APPROVAL_SCOPE_TOOL_NAMES.readDocument },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(
        APPROVAL_SCOPE_TOOL_NAMES.readDocument,
        await runReadDocument(input, context),
      );
    },
  );
  registerTool(
    { ...viewImageTool, name: APPROVAL_SCOPE_TOOL_NAMES.viewImage },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.viewImage, await runViewImage(input, context));
    },
  );
  registerTool(
    { ...sqliteTool, name: APPROVAL_SCOPE_TOOL_NAMES.sqlite },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(APPROVAL_SCOPE_TOOL_NAMES.sqlite, await runSqlite(input, context));
    },
  );
  registerTool(
    { ...promptTool, name: APPROVAL_SCOPE_TOOL_NAMES.promptTemplate },
    async (input, context) => {
      contexts.push(context ?? {});
      return record(
        APPROVAL_SCOPE_TOOL_NAMES.promptTemplate,
        await runPromptTemplate(input, context),
      );
    },
  );
}

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
  buildDirectoryScope,
  buildScopeRegistryProjection,
  type DirectoryScope,
} from "#core/daemon/scope-registry.js";
import { initProviderRegistry } from "#core/modules/provider-registry.js";

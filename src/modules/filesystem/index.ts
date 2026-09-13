import { resolve } from "node:path";
import {
  isConfinedGlobPattern,
  type ToolFilesystemTargetResolver,
} from "#core/tools/filesystem-targets.js";
import { resolveToolPath } from "./path-resolver.js";
/**
 * Filesystem module — file read, write, edit, search, and watch tools.
 * Editors preserve unfinished syntax; publication validates final results.
 *
 * Tools:
 *   file_read      — read a file with line numbers; supports images and PDFs
 *   file_write     — create or overwrite a file
 *   file_edit      — replace an exact string in a file
 *   multi_edit     — prepare final contents across files with write-failure rollback
 *   find_replace   — find-replace across files matching a glob
 *   glob           — find files matching a glob pattern
 *   grep           — search file contents using regex patterns
 *   file_watch     — watch a directory for file changes
 *   files_overview — structured directory overview with file type and size breakdown
 */

import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { localWriteEffect, readOnlyLocalEffect } from "#core/tools/effect.js";
import { fileEditTool, runFileEdit } from "./file-edit.js";
import { fileReadTool, runFileRead } from "./file-read.js";
import { fileWatchTool, runFileWatch } from "./file-watch.js";
import { fileWriteTool, runFileWrite } from "./file-write.js";
import { filesOverviewTool, runFilesOverview } from "./files-overview.js";
import { findReplaceTool, runFindReplace } from "./find-replace.js";
import { globTool, runGlob } from "./glob.js";
import { grepTool, runGrep } from "./grep.js";
import { multiEditTool, runMultiEdit } from "./multi-edit.js";
import { repoMapTool, runRepoMap } from "./repo-map.js";

const fileTarget: ToolFilesystemTargetResolver = (input, context) =>
  typeof input.path === "string"
    ? { kind: "known", paths: [resolve(resolveToolPath(input.path, context))] }
    : { kind: "unknown" };
const readRoot = (
  field: "path" | "directory",
  patternField?: "pattern",
): ToolFilesystemTargetResolver =>
  (input, context) => {
    const value = input[field];
    if (value !== undefined && typeof value !== "string") return { kind: "unknown" };
    const pattern = patternField === undefined ? undefined : input[patternField];
    if (
      pattern !== undefined &&
      (
        typeof pattern !== "string" ||
        !isConfinedGlobPattern(pattern)
      )
    ) {
      return { kind: "unknown" };
    }
    const selected = typeof value === "string" && value.length > 0 ? value : ".";
    return { kind: "known", paths: [resolve(resolveToolPath(selected, context))] };
  };
const editTargets: ToolFilesystemTargetResolver = (input, context) => {
  if (!Array.isArray(input.edits)) return { kind: "unknown" };
  const paths: string[] = [];
  for (const edit of input.edits) {
    if (!edit || typeof edit !== "object" || typeof edit.path !== "string") return { kind: "unknown" };
    paths.push(resolve(resolveToolPath(edit.path, context)));
  }
  return { kind: "known", paths };
};

const tools: ToolDef[] = [
  {
    tool: fileReadTool,
    runner: runFileRead,
    resolveFilesystemTargets: fileTarget,
    effect: readOnlyLocalEffect(),
  },
  {
    tool: fileWriteTool,
    runner: runFileWrite,
    resolveFilesystemTargets: fileTarget,
    effect: localWriteEffect(),
  },
  {
    tool: fileEditTool,
    runner: runFileEdit,
    resolveFilesystemTargets: fileTarget,
    effect: localWriteEffect(),
  },
  {
    tool: multiEditTool,
    runner: runMultiEdit,
    resolveFilesystemTargets: editTargets,
    effect: localWriteEffect(),
    group: "advanced_editing",
  },
  {
    tool: findReplaceTool,
    runner: runFindReplace,
    effect: localWriteEffect(),
    group: "advanced_editing",
  },
  {
    tool: globTool,
    runner: runGlob,
    resolveFilesystemTargets: readRoot("path", "pattern"),
    effect: readOnlyLocalEffect(),
  },
  {
    tool: grepTool,
    runner: runGrep,
    resolveFilesystemTargets: readRoot("path"),
    effect: readOnlyLocalEffect(),
  },
  {
    tool: fileWatchTool,
    runner: runFileWatch,
    effect: localWriteEffect(),
    group: "management",
  },
  {
    tool: filesOverviewTool,
    runner: runFilesOverview,
    resolveFilesystemTargets: readRoot("path"),
    effect: readOnlyLocalEffect(),
  },
  {
    tool: repoMapTool,
    runner: runRepoMap,
    resolveFilesystemTargets: readRoot("directory", "pattern"),
    effect: readOnlyLocalEffect(),
    group: "advanced_editing",
  },
];

const filesystemModule: KotaModule = {
  name: "filesystem",
  version: "1.0.0",
  description:
    "Filesystem tools: file_read, file_write, file_edit, multi_edit, find_replace, glob, grep, file_watch, files_overview, repo_map",
  dependencies: ["rendering"],
  tools,
};

export default filesystemModule;

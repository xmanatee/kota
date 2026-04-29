/**
 * Filesystem module — file read, write, edit, search, and watch tools.
 *
 * Tools:
 *   file_read      — read a file with line numbers; supports images and PDFs
 *   file_write     — create or overwrite a file; lint-gated
 *   file_edit      — replace an exact string in a file; lint-gated
 *   multi_edit     — apply multiple edits atomically across files; lint-gated
 *   find_replace   — find-replace across files matching a glob; lint-gated
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

const tools: ToolDef[] = [
  {
    tool: fileReadTool,
    runner: runFileRead,
    effect: readOnlyLocalEffect(),
  },
  {
    tool: fileWriteTool,
    runner: runFileWrite,
    effect: localWriteEffect(),
  },
  {
    tool: fileEditTool,
    runner: runFileEdit,
    effect: localWriteEffect(),
  },
  {
    tool: multiEditTool,
    runner: runMultiEdit,
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
    effect: readOnlyLocalEffect(),
  },
  {
    tool: grepTool,
    runner: runGrep,
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
    effect: readOnlyLocalEffect(),
  },
  {
    tool: repoMapTool,
    runner: runRepoMap,
    effect: readOnlyLocalEffect(),
    group: "advanced_editing",
  },
];

const filesystemModule: KotaModule = {
  name: "filesystem",
  version: "1.0.0",
  description:
    "Filesystem tools: file_read, file_write, file_edit, multi_edit, find_replace, glob, grep, file_watch, files_overview, repo_map",
  tools,
};

export default filesystemModule;

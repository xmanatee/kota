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

import type { KotaModule, ToolDef } from "../../module-types.js";
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
    risk: "safe",
    kind: "discovery",
  },
  {
    tool: fileWriteTool,
    runner: runFileWrite,
    risk: "moderate",
    kind: "action",
  },
  {
    tool: fileEditTool,
    runner: runFileEdit,
    risk: "moderate",
    kind: "action",
  },
  {
    tool: multiEditTool,
    runner: runMultiEdit,
    risk: "moderate",
    kind: "action",
    group: "advanced_editing",
  },
  {
    tool: findReplaceTool,
    runner: runFindReplace,
    risk: "moderate",
    kind: "action",
    group: "advanced_editing",
  },
  {
    tool: globTool,
    runner: runGlob,
    risk: "safe",
    kind: "discovery",
  },
  {
    tool: grepTool,
    runner: runGrep,
    risk: "safe",
    kind: "discovery",
  },
  {
    tool: fileWatchTool,
    runner: runFileWatch,
    risk: "moderate",
    kind: "action",
    group: "management",
  },
  {
    tool: filesOverviewTool,
    runner: runFilesOverview,
    risk: "safe",
    kind: "discovery",
  },
  {
    tool: repoMapTool,
    runner: runRepoMap,
    risk: "safe",
    kind: "discovery",
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

/**
 * System module — host OS interaction tools.
 *
 * Tools:
 *   clipboard    — read from and write to the system clipboard
 *   view_image   — load a local image file for visual analysis
 *   env_info     — discover host OS, installed runtimes, services, and resources
 *   sqlite       — query SQLite databases (run SQL, list tables, inspect schemas)
 *
 * These are generic capability tools with no dependency on the agent protocol
 * or runtime control primitives. They live here rather than in the core tool
 * registry.
 */

import type { KotaModule, ToolDef } from "../../core/modules/module-types.js";
import { clipboardTool, runClipboard } from "./clipboard.js";
import { envInfoTool, runEnvInfo } from "./env-info.js";
import { notifyTool, runNotify } from "./notify.js";
import { runSqlite, sqliteTool } from "./sqlite.js";
import { runViewImage, viewImageTool } from "./view-image.js";

const tools: ToolDef[] = [
  {
    tool: clipboardTool,
    runner: runClipboard,
    risk: "safe",
    kind: "action",
    group: "gui",
  },
  {
    tool: viewImageTool,
    runner: runViewImage,
    risk: "safe",
    kind: "discovery",
    group: "gui",
  },
  {
    tool: envInfoTool,
    runner: runEnvInfo,
    risk: "safe",
    kind: "discovery",
  },
  {
    tool: sqliteTool,
    runner: runSqlite,
    risk: "moderate",
    kind: "action",
    group: "code",
  },
  {
    tool: notifyTool,
    runner: runNotify,
    risk: "safe",
    kind: "action",
    group: "management",
  },
];

const systemModule: KotaModule = {
  name: "system",
  version: "1.0.0",
  description:
    "System tools: clipboard, view_image, env_info, sqlite, notify",
  tools,
};

export default systemModule;

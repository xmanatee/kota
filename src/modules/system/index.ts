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


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import {
  daemonWriteEffect,
  localWriteEffect,
  operatorSurfaceEffect,
  readOnlyLocalEffect,
} from "#core/tools/effect.js";
import { clipboardTool, runClipboard } from "./clipboard.js";
import { envInfoTool, runEnvInfo } from "./env-info.js";
import { notifyTool, runNotify } from "./notify.js";
import { runSqlite, sqliteTool } from "./sqlite.js";
import { runViewImage, viewImageTool } from "./view-image.js";

const tools: ToolDef[] = [
  {
    tool: clipboardTool,
    runner: runClipboard,
    effect: daemonWriteEffect(),
    group: "gui",
  },
  {
    tool: viewImageTool,
    runner: runViewImage,
    effect: readOnlyLocalEffect(),
    group: "gui",
  },
  {
    tool: envInfoTool,
    runner: runEnvInfo,
    effect: readOnlyLocalEffect(),
  },
  {
    tool: sqliteTool,
    runner: runSqlite,
    effect: localWriteEffect(),
    group: "code",
  },
  {
    tool: notifyTool,
    runner: runNotify,
    effect: operatorSurfaceEffect(),
    group: "management",
  },
];

const systemModule: KotaModule = {
  name: "system",
  version: "1.0.0",
  description:
    "System tools: clipboard, view_image, env_info, sqlite, notify",
  dependencies: ["rendering"],
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "system.host-inspection",
        description: "Inspect local host images, environment metadata, and SQLite data.",
        scope: "global",
        scopePolicyHooks: ["retention"],
      },
      {
        id: "system.operator-surface",
        description: "Write clipboard state and send local operator notifications.",
        scope: "global",
        scopePolicyHooks: ["owner-confirmation", "external-effects", "writes"],
      },
    ],
    dataClasses: [
      {
        id: "system.host-data",
        description: "Local environment details, image metadata, clipboard state, and SQLite query results.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "system.notification-content",
        description: "Operator notification titles and message bodies.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "System tools can mutate local SQLite, clipboard, and operator-notification surfaces and are blocked unless trial mode can isolate the target.",
      ],
    },
  },
  tools,
};

export default systemModule;

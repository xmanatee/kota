/**
 * Built-in modules — ship with KOTA, use the same protocol as external ones.
 *
 * Each module is a self-contained unit that registers its own tools,
 * commands, routes, and event subscriptions through the KotaModule protocol.
 * Add new built-in modules here as they are extracted from the core.
 */

import type { KotaModule } from "../module-types.js";
import daemonModule from "./daemon.js";
import memoryModule from "./memory.js";
import registryModule from "./registry.js";
import schedulerModule from "./scheduler.js";
import secretsModule from "./secrets.js";
import telegramModule from "./telegram.js";
import vercelAdapterModule from "./vercel-adapter.js";
import webModule from "./web.js";

/** All built-in modules, in dependency order. */
export const builtinModules: KotaModule[] = [
  secretsModule,
  memoryModule,
  schedulerModule,
  telegramModule,
  daemonModule,
  vercelAdapterModule,
  webModule,
  registryModule,
];

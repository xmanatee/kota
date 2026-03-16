/**
 * Built-in modules — ship with KOTA, use the same protocol as external ones.
 *
 * Each module is a self-contained unit that registers its own tools,
 * commands, routes, and event subscriptions through the KotaModule protocol.
 * Add new built-in modules here as they are extracted from the core.
 */

import type { KotaModule } from "../module-types.js";
import memoryModule from "./memory.js";

/** All built-in modules, in dependency order. */
export const builtinModules: KotaModule[] = [
  memoryModule,
];

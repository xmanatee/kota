/**
 * Built-in modules — ship with KOTA, use the same protocol as external ones.
 *
 * Each module is a self-contained unit that registers its own tools,
 * commands, routes, and event subscriptions through the KotaExtension protocol.
 * Add new built-in modules here as they are extracted from the core.
 */

import type { KotaExtension } from "../extension-types.js";
import daemonModule from "./daemon.js";
import githubModule from "./github/index.js";
import historyModule from "./history.js";
import knowledgeModule from "./knowledge.js";
import mcpServerModule from "./mcp-server.js";
import memoryModule from "./memory.js";
import registryModule from "./registry.js";
import schedulerModule from "./scheduler.js";
import secretsModule from "./secrets.js";
import slackModule from "./slack.js";
import sqliteMemoryModule from "./sqlite-memory.js";
import telegramModule from "./telegram.js";
import toolCacheModule from "./tool-cache.js";
import toolRetryModule from "./tool-retry.js";
import vercelAdapterModule from "./vercel-adapter.js";
import webModule from "./web.js";
import webhookModule from "./webhook.js";
import workingMemoryModule from "./working-memory.js";

/** All built-in modules, in dependency order. */
export const builtinExtensions: KotaExtension[] = [
  toolCacheModule,
  toolRetryModule,
  workingMemoryModule,
  secretsModule,
  memoryModule,
  sqliteMemoryModule,
  knowledgeModule,
  historyModule,
  schedulerModule,
  telegramModule,
  webhookModule,
  slackModule,
  daemonModule,
  githubModule,
  vercelAdapterModule,
  webModule,
  registryModule,
  mcpServerModule,
];

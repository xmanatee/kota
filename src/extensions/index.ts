/**
 * Built-in extensions — ship with KOTA and use the same protocol as external
 * ones.
 *
 * Each extension is a self-contained unit that registers its own tools,
 * commands, routes, and event subscriptions through the KotaExtension
 * protocol. Add new built-in extensions here as they are extracted from the
 * core.
 */

import type { KotaExtension } from "../extension-types.js";
import agentsModule from "./agents/index.js";
import approvalQueueModule from "./approval-queue/index.js";
import configModule from "./config/index.js";
import daemonModule from "./daemon/index.js";
import doctorModule from "./doctor/index.js";
import executionModule from "./execution/index.js";
import extensionManagerModule from "./extension-manager/index.js";
import filesystemModule from "./filesystem/index.js";
import gitModule from "./git/index.js";
import githubModule from "./github/index.js";
import githubWebhookModule from "./github-webhook/index.js";
import guardrailsAuditModule from "./guardrails-audit/index.js";
import historyModule from "./history/index.js";
import knowledgeModule from "./knowledge/index.js";
import mcpServerModule from "./mcp-server/index.js";
import memoryModule from "./memory/index.js";
import modelClientsModule from "./model-clients/index.js";
import notebookModule from "./notebook/index.js";
import notificationsModule from "./notifications/index.js";
import readDocumentModule from "./read-document/index.js";
import registryModule from "./registry/index.js";
import repoTasksModule from "./repo-tasks/index.js";
import schedulerModule from "./scheduler/index.js";
import secretsModule from "./secrets/index.js";
import skillsModule from "./skills/index.js";
import slackModule from "./slack/index.js";
import sqliteMemoryModule from "./sqlite-memory/index.js";
import systemModule from "./system/index.js";
import telegramModule from "./telegram/index.js";
import toolCacheModule from "./tool-cache/index.js";
import toolRetryModule from "./tool-retry/index.js";
import vercelAdapterModule from "./vercel-adapter/index.js";
import webModule from "./web/index.js";
import webAccessModule from "./web-access/index.js";
import webhookModule from "./webhook/index.js";
import workingMemoryModule from "./working-memory/index.js";

/** All built-in extensions, in dependency order. */
export const builtinExtensions: KotaExtension[] = [
  notificationsModule,
  modelClientsModule,
  agentsModule,
  skillsModule,
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
  githubWebhookModule,
  vercelAdapterModule,
  executionModule,
  filesystemModule,
  systemModule,
  gitModule,
  notebookModule,
  readDocumentModule,
  webAccessModule,
  webModule,
  registryModule,
  extensionManagerModule,
  mcpServerModule,
  approvalQueueModule,
  guardrailsAuditModule,
  repoTasksModule,
  doctorModule,
  configModule,
];

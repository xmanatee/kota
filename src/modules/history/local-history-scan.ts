import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SCOPE_ROOT_ENV_VAR } from "#core/config/scope-root.js";
import type { ConversationRecord } from "#core/modules/provider-types.js";

const LOCAL_HISTORY_SCAN_MAX_GENERAL_CHILDREN = 1000;
const LOCAL_HISTORY_SCAN_MAX_PREFERRED_CHILDREN = 1000;

export type LocalHistoryScanOptions = {
  cwd: string;
  limit?: number;
};

export function listLocalScopeHistoryRecords(
  options: LocalHistoryScanOptions,
): ConversationRecord[] {
  const seen = new Set<string>();
  const conversations: ConversationRecord[] = [];
  if (addScopeHistoryRecords(options.cwd, seen, conversations, options.limit)) {
    return conversations.slice(0, options.limit);
  }
  if (
    addScopeHistoryRecords(
      process.env[SCOPE_ROOT_ENV_VAR],
      seen,
      conversations,
      options.limit,
    )
  ) {
    return conversations.slice(0, options.limit);
  }
  if (
    addChildHistoryScopes(options.cwd, seen, conversations, options.limit)
  ) {
    return conversations.slice(0, options.limit);
  }
  if (
    addChildHistoryScopes(
      dirname(options.cwd),
      seen,
      conversations,
      options.limit,
    )
  ) {
    return conversations.slice(0, options.limit);
  }
  return conversations;
}

function addScopeHistoryRecords(
  dir: string | undefined,
  seen: Set<string>,
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  const trimmed = dir?.trim();
  if (!trimmed) return false;
  const scopeRoot = resolve(trimmed);
  if (seen.has(scopeRoot)) return hasReachedLimit(conversations, limit);
  seen.add(scopeRoot);
  conversations.push(...readLocalScopeHistoryRecords(scopeRoot));
  return hasReachedLimit(conversations, limit);
}

function addChildHistoryScopes(
  root: string,
  seen: Set<string>,
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }

  const preferred = entries
    .filter((entry) => entry.name.includes("kota"))
    .slice(0, LOCAL_HISTORY_SCAN_MAX_PREFERRED_CHILDREN);
  const general = entries
    .filter((entry) => !entry.name.includes("kota"))
    .slice(0, LOCAL_HISTORY_SCAN_MAX_GENERAL_CHILDREN);
  return (
    scanChildHistoryScopes(root, preferred, seen, conversations, limit) ||
    scanChildHistoryScopes(root, general, seen, conversations, limit)
  );
}

function scanChildHistoryScopes(
  root: string,
  entries: Dirent[],
  seen: Set<string>,
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const scopeRoot = join(root, entry.name);
    if (existsSync(join(scopeRoot, ".kota", "history", "index.json"))) {
      if (addScopeHistoryRecords(scopeRoot, seen, conversations, limit)) {
        return true;
      }
    }
  }
  return false;
}

function readLocalScopeHistoryRecords(scopeRoot: string): ConversationRecord[] {
  const indexPath = join(scopeRoot, ".kota", "history", "index.json");
  if (!existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as {
      conversations?: Partial<ConversationRecord>[];
    };
    if (!Array.isArray(parsed.conversations)) return [];
    return parsed.conversations.filter(isConversationRecord);
  } catch {
    return [];
  }
}

function hasReachedLimit(
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  return limit !== undefined && conversations.length >= limit;
}

function isConversationRecord(
  record: Partial<ConversationRecord>,
): record is ConversationRecord {
  const source = record.source;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.model === "string" &&
    typeof record.messageCount === "number" &&
    typeof record.cwd === "string" &&
    (source === undefined || source === "user" || source === "action")
  );
}

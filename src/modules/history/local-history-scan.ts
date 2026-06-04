import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROJECT_DIR_ENV_VAR } from "#core/config/project-dir.js";
import type { ConversationRecord } from "#core/modules/provider-types.js";

const LOCAL_HISTORY_SCAN_MAX_GENERAL_CHILDREN = 1000;
const LOCAL_HISTORY_SCAN_MAX_PREFERRED_CHILDREN = 1000;

export type LocalHistoryScanOptions = {
  cwd: string;
  limit?: number;
};

export function listLocalProjectHistoryRecords(
  options: LocalHistoryScanOptions,
): ConversationRecord[] {
  const seen = new Set<string>();
  const conversations: ConversationRecord[] = [];
  if (addProjectHistoryRecords(options.cwd, seen, conversations, options.limit)) {
    return conversations.slice(0, options.limit);
  }
  if (
    addProjectHistoryRecords(
      process.env[PROJECT_DIR_ENV_VAR],
      seen,
      conversations,
      options.limit,
    )
  ) {
    return conversations.slice(0, options.limit);
  }
  if (
    addChildHistoryProjects(options.cwd, seen, conversations, options.limit)
  ) {
    return conversations.slice(0, options.limit);
  }
  if (
    addChildHistoryProjects(
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

function addProjectHistoryRecords(
  dir: string | undefined,
  seen: Set<string>,
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  const trimmed = dir?.trim();
  if (!trimmed) return false;
  const projectDir = resolve(trimmed);
  if (seen.has(projectDir)) return hasReachedLimit(conversations, limit);
  seen.add(projectDir);
  conversations.push(...readLocalProjectHistoryRecords(projectDir));
  return hasReachedLimit(conversations, limit);
}

function addChildHistoryProjects(
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
    scanChildHistoryProjects(root, preferred, seen, conversations, limit) ||
    scanChildHistoryProjects(root, general, seen, conversations, limit)
  );
}

function scanChildHistoryProjects(
  root: string,
  entries: Dirent[],
  seen: Set<string>,
  conversations: ConversationRecord[],
  limit: number | undefined,
): boolean {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(root, entry.name);
    if (existsSync(join(projectDir, ".kota", "history", "index.json"))) {
      if (addProjectHistoryRecords(projectDir, seen, conversations, limit)) {
        return true;
      }
    }
  }
  return false;
}

function readLocalProjectHistoryRecords(projectDir: string): ConversationRecord[] {
  const indexPath = join(projectDir, ".kota", "history", "index.json");
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

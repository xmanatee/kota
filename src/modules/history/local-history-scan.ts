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

export type LocalHistoryScanOptions = {
  cwd: string;
  limit?: number;
};

export function listLocalProjectHistoryRecords(
  options: LocalHistoryScanOptions,
): ConversationRecord[] {
  const conversations: ConversationRecord[] = [];
  for (const projectDir of localHistoryCandidateProjectDirs(options.cwd)) {
    conversations.push(...readLocalProjectHistoryRecords(projectDir));
    if (options.limit !== undefined && conversations.length >= options.limit) {
      return conversations.slice(0, options.limit);
    }
  }
  return conversations;
}

function localHistoryCandidateProjectDirs(cwd: string): string[] {
  const dirs = new Set<string>();
  const add = (dir: string | undefined) => {
    const trimmed = dir?.trim();
    if (trimmed) dirs.add(resolve(trimmed));
  };

  add(cwd);
  add(process.env[PROJECT_DIR_ENV_VAR]);
  addChildHistoryProjects(cwd, dirs);
  addChildHistoryProjects(dirname(cwd), dirs);
  return [...dirs];
}

function addChildHistoryProjects(root: string, dirs: Set<string>): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  const preferred = entries.filter((entry) => entry.name.includes("kota"));
  const general = entries.filter((entry) => !entry.name.includes("kota"));
  scanChildHistoryProjects(root, preferred, dirs);
  scanChildHistoryProjects(
    root,
    general.slice(0, LOCAL_HISTORY_SCAN_MAX_GENERAL_CHILDREN),
    dirs,
  );
}

function scanChildHistoryProjects(
  root: string,
  entries: Dirent[],
  dirs: Set<string>,
): void {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(root, entry.name);
    if (existsSync(join(projectDir, ".kota", "history", "index.json"))) {
      dirs.add(resolve(projectDir));
    }
  }
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

import { readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { jsonResponse } from "./session-pool.js";

type TaskSummary = {
  id: string;
  title: string;
  priority: string;
};

type TasksResponse = {
  counts: {
    inbox: number;
    ready: number;
    backlog: number;
    doing: number;
    blocked: number;
  };
  doing: TaskSummary[];
};

const COUNTED_STATES = ["inbox", "ready", "backlog", "doing", "blocked"] as const;

function listTaskFiles(tasksDir: string, state: string): string[] {
  const dir = join(tasksDir, state);
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
  } catch {
    return [];
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = value;
  }
  return fields;
}

function readDoingTasks(tasksDir: string): TaskSummary[] {
  const files = listTaskFiles(tasksDir, "doing");
  const result: TaskSummary[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(tasksDir, "doing", file), "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.id && fm.title) {
        result.push({ id: fm.id, title: fm.title, priority: fm.priority ?? "" });
      }
    } catch {
      // skip unreadable files
    }
  }
  return result;
}

export function handleTaskStatus(res: ServerResponse, projectDir = process.cwd()): void {
  const tasksDir = join(projectDir, "tasks");
  const counts = Object.fromEntries(
    COUNTED_STATES.map((state) => [state, listTaskFiles(tasksDir, state).length]),
  ) as TasksResponse["counts"];
  const doing = readDoingTasks(tasksDir);
  jsonResponse(res, 200, { counts, doing } satisfies TasksResponse);
}

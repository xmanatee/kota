import { readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import type { DaemonControlClient } from "./daemon-client.js";
import { jsonResponse } from "./session-pool.js";

type TaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
};

type TasksResponse = {
  counts: {
    inbox: number;
    ready: number;
    backlog: number;
    doing: number;
    blocked: number;
  };
  tasks: {
    doing: TaskDetail[];
    ready: TaskDetail[];
    backlog: TaskDetail[];
    blocked: TaskDetail[];
  };
};

const COUNTED_STATES = ["inbox", "ready", "backlog", "doing", "blocked"] as const;
const DETAIL_STATES = ["doing", "ready", "backlog", "blocked"] as const;

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

function extractBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1].trim() : "";
}

function readStateTasks(tasksDir: string, state: string): TaskDetail[] {
  const files = listTaskFiles(tasksDir, state);
  const result: TaskDetail[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(tasksDir, state, file), "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.id && fm.title) {
        result.push({
          id: fm.id,
          title: fm.title,
          priority: fm.priority ?? "",
          area: fm.area ?? "",
          summary: fm.summary ?? "",
          body: extractBody(content),
        });
      }
    } catch {
      // skip unreadable files
    }
  }
  return result;
}

export async function handleTaskStatus(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
  projectDir = process.cwd(),
): Promise<void> {
  if (client) {
    const result = await client.getTaskStatus();
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }

  const tasksDir = join(projectDir, "tasks");
  const counts = Object.fromEntries(
    COUNTED_STATES.map((state) => [state, listTaskFiles(tasksDir, state).length]),
  ) as TasksResponse["counts"];
  const tasks = Object.fromEntries(
    DETAIL_STATES.map((state) => [state, readStateTasks(tasksDir, state)]),
  ) as TasksResponse["tasks"];
  jsonResponse(res, 200, { counts, tasks } satisfies TasksResponse);
}

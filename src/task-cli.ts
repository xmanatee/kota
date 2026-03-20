import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "./frontmatter.js";
import { REPO_TASK_STATES, type RepoTaskState } from "./repo-tasks.js";

const OPEN_STATES: RepoTaskState[] = ["inbox", "backlog", "ready", "doing", "blocked"];

type TaskEntry = {
  id: string;
  priority: string;
  title: string;
  state: RepoTaskState;
};

export function listTasksForStates(tasksDir: string, states: RepoTaskState[]): TaskEntry[] {
  const results: TaskEntry[] = [];
  for (const state of states) {
    const dir = join(tasksDir, state);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const { attrs } = parseFlatFrontMatter(content);
        results.push({
          id: String(attrs.id || basename(file, ".md")),
          priority: String(attrs.priority || ""),
          title: String(attrs.title || "(no title)"),
          state,
        });
      } catch {
        results.push({ id: basename(file, ".md"), priority: "", title: "(unreadable)", state });
      }
    }
  }
  return results;
}

export function findTask(
  tasksDir: string,
  id: string,
): { path: string; state: RepoTaskState; content: string } | null {
  for (const state of REPO_TASK_STATES) {
    const filePath = join(tasksDir, state, `${id}.md`);
    if (existsSync(filePath)) {
      return { path: filePath, state, content: readFileSync(filePath, "utf-8") };
    }
  }
  return null;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

export function registerTaskCommands(program: Command): void {
  const taskCmd = program
    .command("task")
    .description("Inspect and manage the repo task queue");

  taskCmd
    .command("list")
    .description("List tasks in the queue")
    .option(
      "-s, --state <state>",
      "Filter by state (inbox|backlog|ready|doing|blocked|done|dropped)",
    )
    .action((opts: { state?: string }) => {
      const tasksDir = join(process.cwd(), "tasks");
      let states: RepoTaskState[];
      if (opts.state) {
        if (!REPO_TASK_STATES.includes(opts.state as RepoTaskState)) {
          console.error(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`);
          process.exit(1);
        }
        states = [opts.state as RepoTaskState];
      } else {
        states = OPEN_STATES;
      }

      const tasks = listTasksForStates(tasksDir, states);
      if (tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }

      const idWidth = Math.max(...tasks.map((t) => t.id.length), 4);
      const prioWidth = 4;
      const stateWidth = Math.max(...tasks.map((t) => t.state.length), 5);
      console.log(
        `${"ID".padEnd(idWidth)}  ${"Pri".padEnd(prioWidth)}  ${"State".padEnd(stateWidth)}  Title`,
      );
      console.log("-".repeat(idWidth + prioWidth + stateWidth + 12));
      for (const t of tasks) {
        console.log(
          `${t.id.padEnd(idWidth)}  ${t.priority.padEnd(prioWidth)}  ${t.state.padEnd(stateWidth)}  ${t.title}`,
        );
      }
    });

  taskCmd
    .command("show <id>")
    .description("Print the full content of a task")
    .action((id: string) => {
      const tasksDir = join(process.cwd(), "tasks");
      const found = findTask(tasksDir, id);
      if (!found) {
        console.error(`Task "${id}" not found.`);
        process.exit(1);
      }
      process.stdout.write(found.content);
      if (!found.content.endsWith("\n")) console.log();
    });

  taskCmd
    .command("move <id> <state>")
    .description("Move a task to the target state, updating status frontmatter")
    .action((id: string, targetState: string) => {
      if (!REPO_TASK_STATES.includes(targetState as RepoTaskState)) {
        console.error(`Unknown state "${targetState}". Valid: ${REPO_TASK_STATES.join(", ")}`);
        process.exit(1);
      }
      const tasksDir = join(process.cwd(), "tasks");
      const found = findTask(tasksDir, id);
      if (!found) {
        console.error(`Task "${id}" not found.`);
        process.exit(1);
      }
      if (found.state === targetState) {
        console.log(`Task "${id}" is already in "${targetState}".`);
        return;
      }

      const dstPath = join(tasksDir, targetState, `${id}.md`);
      const { attrs, body } = parseFlatFrontMatter(found.content);
      attrs.status = targetState;
      attrs.updated_at = new Date().toISOString().slice(0, 10);
      const updated = serializeFlatFrontMatter(attrs, body);

      execSync(`git mv "${found.path}" "${dstPath}"`, { cwd: process.cwd() });
      writeFileSync(dstPath, updated, "utf-8");
      execSync(`git add "${dstPath}"`, { cwd: process.cwd() });

      console.log(`Moved "${id}" from "${found.state}" to "${targetState}".`);
    });

  taskCmd
    .command("add <title>")
    .description("Create a new inbox task from a title")
    .action((title: string) => {
      const tasksDir = join(process.cwd(), "tasks");
      const slug = slugify(title);
      if (!slug) {
        console.error("Title produced an empty slug. Use a more descriptive title.");
        process.exit(1);
      }

      const id = `task-${slug}`;
      const inboxDir = join(tasksDir, "inbox");
      mkdirSync(inboxDir, { recursive: true });
      const filePath = join(inboxDir, `${id}.md`);

      if (existsSync(filePath)) {
        console.error(`Task file "${id}.md" already exists in inbox.`);
        process.exit(1);
      }

      const today = new Date().toISOString().slice(0, 10);
      const content = `---\nid: ${id}\ntitle: ${title}\nstatus: inbox\ncreated_at: ${today}\nupdated_at: ${today}\n---\n`;
      writeFileSync(filePath, content, "utf-8");
      console.log(`Created task "${id}" in inbox.`);
    });
}

/**
 * Adapters that wrap each first-party store writer into a
 * `CaptureContributor`. The adapters are owned by the capture module so
 * adding a new contributor is a registration here, not an edit across
 * every consumer.
 *
 * Each adapter delegates to the store's existing in-process writer:
 *
 * - memory   — `MemoryProvider.save(content)` returns the new memory id.
 * - knowledge — `KnowledgeProvider.create({ title, content })` returns
 *               the slug; the title is the first non-empty line of the
 *               note (capped) and the body is the remainder.
 * - tasks    — `createNormalizedTask` writes a normalized task into
 *               `data/tasks/backlog/` and stages the new file. The first
 *               non-empty line is the title.
 * - inbox    — `captureInboxTask` writes a quick `# title` note into
 *               `data/inbox/` without a random suffix.
 *
 * Errors from the underlying writer (filesystem failure, slug collision,
 * empty title) propagate verbatim so the seam can surface them as the
 * typed `contributor_failed` arm.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import {
  getRepoInboxDir,
  REPO_INBOX_DIR,
  REPO_TASKS_DIR,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  createNormalizedTask,
  slugifyTaskTitle,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import type {
  CaptureContributor,
  CaptureContributorInput,
} from "./capture-types.js";

const KNOWLEDGE_TITLE_MAX = 80;

/**
 * The first non-empty line of `text`, trimmed and capped at `max`.
 * Returns the empty string when no non-empty line exists; callers throw
 * loudly on an empty title rather than minting an unaddressable record.
 */
function firstLine(text: string, max: number): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max - 1).trimEnd();
  }
  return "";
}

export function createMemoryContributor(
  provider: MemoryProvider,
): CaptureContributor {
  return {
    target: "memory",
    async capture(input: CaptureContributorInput) {
      const id = provider.save(input.text);
      return { target: "memory", recordId: id };
    },
  };
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): CaptureContributor {
  return {
    target: "knowledge",
    async capture(input: CaptureContributorInput) {
      const title = firstLine(input.text, KNOWLEDGE_TITLE_MAX);
      if (title === "") {
        throw new Error("Knowledge capture requires a non-empty first line.");
      }
      const id = provider.create({ title, content: input.text });
      return { target: "knowledge", recordId: id };
    },
  };
}

export function createTasksContributor(projectDir: string): CaptureContributor {
  return {
    target: "tasks",
    async capture(input: CaptureContributorInput) {
      const title = firstLine(input.text, 120);
      if (title === "") {
        throw new Error("Task capture requires a non-empty first line.");
      }
      const result = createNormalizedTask(projectDir, {
        title,
        priority: "p3",
        area: "uncategorized",
        state: "backlog",
        summary: title,
      });
      if (!result.ok) {
        throw new Error(
          `Task capture rejected: ${result.reason}${
            result.message ? ` — ${result.message}` : ""
          }`,
        );
      }
      const repoRelative = join(REPO_TASKS_DIR, "backlog", `${result.id}.md`);
      return {
        target: "tasks",
        recordId: result.id,
        path: repoRelative,
      };
    },
  };
}

export function createInboxContributor(projectDir: string): CaptureContributor {
  return {
    target: "inbox",
    async capture(input: CaptureContributorInput) {
      const title = firstLine(input.text, 120);
      if (title === "") {
        throw new Error("Inbox capture requires a non-empty first line.");
      }
      const slug = slugifyTaskTitle(title);
      if (slug === "") {
        throw new Error(
          "Inbox capture: title produced an empty slug. Use a more descriptive first line.",
        );
      }
      const id = `note-${slug}`;
      const inboxDir = getRepoInboxDir(projectDir);
      mkdirSync(inboxDir, { recursive: true });
      const filePath = join(inboxDir, `${id}.md`);
      if (existsSync(filePath)) {
        throw new Error(`Inbox file "${id}.md" already exists.`);
      }
      const body = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
      writeFileSync(filePath, body, "utf-8");
      const repoRelative = join(REPO_INBOX_DIR, `${id}.md`);
      return { target: "inbox", recordId: id, path: repoRelative };
    },
  };
}

/**
 * Adapters that wrap each first-party store's removal helper into a
 * `RetractContributor`. The adapters are owned by the retract module so
 * adding a new contributor is a registration here, not an edit across
 * every consumer.
 *
 * Each adapter delegates to the store's existing in-process removal API:
 *
 * - memory    — `MemoryProvider.delete(id)` returns whether the id existed.
 * - knowledge — `KnowledgeProvider.delete(slug)` deletes the slug-indexed
 *               file. The seam returns `not_found` if the slug is unknown.
 * - tasks     — `moveTaskById(projectDir, id, "dropped")` routes through
 *               the existing state machine. The contributor never deletes
 *               the file and never bypasses `updated_at` / `git mv`.
 * - inbox     — `unlinkSync` against the resolved repo-relative path. The
 *               contributor refuses any path outside `data/inbox/`.
 *
 * Errors from the underlying writer (filesystem failure, git failure,
 * unexpected state) propagate verbatim so the seam can surface them as the
 * typed `contributor_failed` arm.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import {
  getRepoInboxDir,moveTaskById, 
  REPO_INBOX_DIR,
  REPO_TASKS_DIR
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  InboxRetractContributor,
  KnowledgeRetractContributor,
  MemoryRetractContributor,
  RetractContributorResult,
  TasksRetractContributor,
} from "./retract-types.js";

export function createMemoryContributor(
  provider: MemoryProvider,
): MemoryRetractContributor {
  return {
    target: "memory",
    async retract({ id }): Promise<RetractContributorResult> {
      const removed = provider.delete(id);
      if (!removed) {
        return { kind: "not_found", identifier: id };
      }
      return {
        kind: "removed",
        record: { target: "memory", recordId: id },
      };
    },
  };
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): KnowledgeRetractContributor {
  return {
    target: "knowledge",
    async retract({ slug }): Promise<RetractContributorResult> {
      const removed = provider.delete(slug);
      if (!removed) {
        return { kind: "not_found", identifier: slug };
      }
      return {
        kind: "removed",
        record: { target: "knowledge", recordId: slug },
      };
    },
  };
}

export function createTasksContributor(
  projectDir: string,
): TasksRetractContributor {
  return {
    target: "tasks",
    async retract({ id }): Promise<RetractContributorResult> {
      // Refuse to act if the task is not under any state directory; the
      // seam should never silently invent a destination.
      const tasksRoot = join(projectDir, REPO_TASKS_DIR);
      let exists = false;
      try {
        // moveTaskById throws "not found" when the id is absent in any
        // state dir. We translate that into the typed `not_found` arm.
        exists = anyTaskStateContains(tasksRoot, id);
      } catch {
        exists = false;
      }
      if (!exists) {
        return { kind: "not_found", identifier: id };
      }
      const result = moveTaskById(projectDir, id, "dropped");
      return {
        kind: "removed",
        record: {
          target: "tasks",
          recordId: result.id,
          previousPath: result.previousPath,
          path: result.path,
          toState: "dropped",
        },
      };
    },
  };
}

function anyTaskStateContains(tasksRoot: string, id: string): boolean {
  // Inline the state list rather than importing REPO_TASK_STATES so the
  // contributor stays self-contained on the path that decides
  // existence-vs-not_found.
  const states = ["backlog", "ready", "doing", "blocked", "done", "dropped"];
  for (const state of states) {
    if (existsSync(join(tasksRoot, state, `${id}.md`))) return true;
  }
  return false;
}

export function createInboxContributor(
  projectDir: string,
): InboxRetractContributor {
  return {
    target: "inbox",
    async retract({ path }): Promise<RetractContributorResult> {
      const inboxDir = getRepoInboxDir(projectDir);
      const absolute = normalize(join(projectDir, path));
      const inside = relative(inboxDir, absolute);
      if (
        inside.startsWith("..") ||
        inside === "" ||
        inside.includes("/")
      ) {
        throw new Error(
          `Refusing to retract inbox path outside ${REPO_INBOX_DIR}: ${path}`,
        );
      }
      if (!existsSync(absolute)) {
        return { kind: "not_found", identifier: path };
      }
      unlinkSync(absolute);
      const recordId = inside.replace(/\.md$/, "");
      return {
        kind: "removed",
        record: { target: "inbox", recordId, path },
      };
    },
  };
}

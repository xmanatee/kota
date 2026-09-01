import {
  mutateRepoTask,
  type RepoTaskMutationTarget,
} from "#modules/repo-tasks/repo-task-mutation-boundary.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import type { CaptureScopeContext, CaptureTarget } from "./capture-types.js";
import type { CaptureResult } from "./client.js";

const KNOWLEDGE_TITLE_MAX = 80;
const REPO_TITLE_MAX = 120;

function firstLine(text: string, max: number): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length <= max ? line : line.slice(0, max - 1).trimEnd();
}

function canonicalTarget(scopeId: string): RepoTaskMutationTarget {
  return { authority: "canonical", scopeId };
}

/** Maps one selected target into its owning store's canonical write operation. */
export async function writeCaptureTarget({
  target,
  text,
  scope,
}: {
  target: CaptureTarget;
  text: string;
  scope: CaptureScopeContext;
}): Promise<CaptureResult> {
  switch (target) {
    case "memory":
      return { ok: true, target, id: scope.memory.save(text) };
    case "knowledge": {
      const title = firstLine(text, KNOWLEDGE_TITLE_MAX);
      if (!title) throw new Error("Knowledge capture requires a non-empty first line.");
      return {
        ok: true,
        target,
        id: scope.knowledge.create({ title, content: text }),
      };
    }
    case "tasks": {
      const title = firstLine(text, REPO_TITLE_MAX);
      if (!title) throw new Error("Task capture requires a non-empty first line.");
      const result = await mutateRepoTask(canonicalTarget(scope.scopeId), {
        kind: "create",
        options: { title, priority: "p3", state: "open" },
      });
      return { target, ...result };
    }
    case "inbox": {
      const title = firstLine(text, REPO_TITLE_MAX);
      if (!title) throw new Error("Inbox capture requires a non-empty first line.");
      const slug = slugifyTaskTitle(title);
      if (!slug) {
        return {
          ok: false,
          target,
          reason: "invalid_slug",
          message: "Use a more descriptive first line.",
        };
      }
      const result = await mutateRepoTask(canonicalTarget(scope.scopeId), {
        kind: "capture-inbox",
        id: `note-${slug}`,
        content: text.endsWith("\n") ? text : `${text}\n`,
      });
      return { target, ...result };
    }
  }
}

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
 * - tasks    — the repo-task writer workflow creates a normalized backlog
 *               task from the first non-empty line.
 * - inbox    — the same writer workflow creates the verified inbox note.
 *
 * Errors from the underlying writer (filesystem failure, slug collision,
 * empty title) propagate verbatim so the seam can surface them as the
 * typed `contributor_failed` arm.
 */
import { join } from "node:path";
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import {
	mutateRepoTask,
	type RepoTaskMutationTarget,
	type RepoTaskRuntimeSandboxTarget,
} from "#modules/repo-tasks/repo-task-mutation-boundary.js";
import { REPO_INBOX_DIR, REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import type {
  CaptureContributor,
  CaptureContributorInput,
  CaptureScopeContext,
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

function requireScope(
  scope: CaptureScopeContext | undefined,
): CaptureScopeContext {
  if (!scope) {
    throw new Error("Capture contributor requires a scope context");
  }
  return scope;
}

function createMemoryRecord(
  provider: MemoryProvider,
  input: CaptureContributorInput,
) {
  const id = provider.save(input.text);
  return { target: "memory" as const, recordId: id };
}

function createKnowledgeRecord(
  provider: KnowledgeProvider,
  input: CaptureContributorInput,
) {
  const title = firstLine(input.text, KNOWLEDGE_TITLE_MAX);
  if (title === "") {
    throw new Error("Knowledge capture requires a non-empty first line.");
  }
  const id = provider.create({ title, content: input.text });
  return { target: "knowledge" as const, recordId: id };
}

async function createTasksRecord(
	target: RepoTaskMutationTarget,
  input: CaptureContributorInput,
) {
  const title = firstLine(input.text, 120);
  if (title === "") {
    throw new Error("Task capture requires a non-empty first line.");
  }
  const result = await mutateRepoTask(target, {
    kind: "create",
    options: {
      title,
      priority: "p3",
      area: "uncategorized",
      state: "backlog",
      summary: title,
    },
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
    target: "tasks" as const,
    recordId: result.id,
    path: repoRelative,
  };
}

async function createInboxRecord(
	target: RepoTaskMutationTarget,
  input: CaptureContributorInput,
) {
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
  const body = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
  const result = await mutateRepoTask(target, {
    kind: "capture-inbox",
    id,
    content: body,
  });
  if (!result.ok) {
    throw new Error(`Inbox file "${id}.md" already exists.`);
  }
  const repoRelative = join(REPO_INBOX_DIR, `${id}.md`);
  return { target: "inbox" as const, recordId: id, path: repoRelative };
}

export function createMemoryContributor(
  provider: MemoryProvider,
): CaptureContributor {
  return {
    target: "memory",
    async capture(input: CaptureContributorInput) {
      return createMemoryRecord(provider, input);
    },
  };
}

export function createScopeMemoryContributor(): CaptureContributor {
  return {
    target: "memory",
    async capture(input: CaptureContributorInput) {
      return createMemoryRecord(requireScope(input.scope).memory, input);
    },
  };
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): CaptureContributor {
  return {
    target: "knowledge",
    async capture(input: CaptureContributorInput) {
      return createKnowledgeRecord(provider, input);
    },
  };
}

export function createScopeKnowledgeContributor(): CaptureContributor {
  return {
    target: "knowledge",
    async capture(input: CaptureContributorInput) {
      return createKnowledgeRecord(requireScope(input.scope).knowledge, input);
    },
  };
}

export function createTasksContributor(
	target: RepoTaskRuntimeSandboxTarget,
): CaptureContributor {
  return {
    target: "tasks",
    async capture(input: CaptureContributorInput) {
		return createTasksRecord(target, input);
    },
  };
}

export function createScopeTasksContributor(): CaptureContributor {
  return {
    target: "tasks",
    async capture(input: CaptureContributorInput) {
        const { scopeId } = requireScope(input.scope);
		return createTasksRecord(
            { authority: "canonical", scopeId },
			input,
		);
    },
  };
}

export function createInboxContributor(
	target: RepoTaskRuntimeSandboxTarget,
): CaptureContributor {
  return {
    target: "inbox",
    async capture(input: CaptureContributorInput) {
		return createInboxRecord(target, input);
    },
  };
}

export function createScopeInboxContributor(): CaptureContributor {
  return {
    target: "inbox",
    async capture(input: CaptureContributorInput) {
        const { scopeId } = requireScope(input.scope);
		return createInboxRecord(
            { authority: "canonical", scopeId },
			input,
		);
    },
  };
}

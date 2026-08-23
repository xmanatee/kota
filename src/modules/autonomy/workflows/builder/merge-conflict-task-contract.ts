import { spawnSync } from "node:child_process";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
	REPO_TASK_STATES,
	type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { isRepoTaskId } from "#modules/repo-tasks/task-id.js";

const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TASK_CONTRACT_MAX_BYTES = 1_000_000;

export type MergeConflictTaskContract = {
	state: RepoTaskState;
	content: string;
	revision: string;
	path: string;
};

export type MergeConflictTaskContractResult =
	| { found: true; task: MergeConflictTaskContract }
	| { found: false; reason: string };

function gitBlobAtRevision(
	workspaceDir: string,
	revision: string,
	path: string,
): string | null {
	const result = spawnSync("git", ["cat-file", "blob", `${revision}:${path}`], {
		cwd: workspaceDir,
		env: withProtectedGitBareRepositoryEnv(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: TASK_CONTRACT_MAX_BYTES,
	});
	if (result.error) {
		throw new Error(`could not read immutable task contract: ${result.error.message}`);
	}
	if (result.status !== 0) return null;
	return result.stdout;
}

/** Read the claimed task from an immutable commit, never from the merge worktree. */
export function loadMergeConflictTaskContract(input: {
	workspaceDir: string;
	taskId: string;
	revision: string;
}): MergeConflictTaskContractResult {
	if (!isRepoTaskId(input.taskId)) {
		return { found: false, reason: `invalid claimed task id ${input.taskId}` };
	}
	if (!FULL_GIT_OBJECT_ID.test(input.revision)) {
		return {
			found: false,
			reason: `task contract revision is not a full Git object id: ${input.revision}`,
		};
	}

	const matches: MergeConflictTaskContract[] = [];
	try {
		for (const state of REPO_TASK_STATES) {
			const path = `data/tasks/${state}/${input.taskId}.md`;
			const content = gitBlobAtRevision(input.workspaceDir, input.revision, path);
			if (content === null) continue;
			const { attrs } = parseFlatFrontMatter(content);
			if (attrs.id !== input.taskId || attrs.status !== state) {
				return {
					found: false,
					reason: `immutable task contract ${path} has mismatched id or state`,
				};
			}
			matches.push({ state, content, revision: input.revision, path });
		}
	} catch (error) {
		return {
			found: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}

	if (matches.length === 0) {
		return {
			found: false,
			reason: `claimed task contract ${input.taskId} is absent at revision ${input.revision}`,
		};
	}
	if (matches.length !== 1) {
		return {
			found: false,
			reason: `claimed task contract ${input.taskId} is ambiguous at revision ${input.revision}`,
		};
	}
	return { found: true, task: matches[0] };
}

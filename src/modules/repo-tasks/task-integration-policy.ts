import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowIntegrationPolicy, WorkflowPostReconcileInvariant } from "#core/workflow/types.js";
import { isRepoTaskId } from "./task-id.js";

/** Execute the installed task validator, independent of the target project's tooling. */
export const taskQueueValidationCommand: readonly [string, ...string[]] = [
  process.execPath,
  ...(import.meta.url.endsWith(".ts")
    ? ["--conditions=source", "--import", import.meta.resolve("tsx")]
    : []),
  fileURLToPath(import.meta.resolve("#root/validate-queue.js")),
];

/** Runtime owns claims; task publication must respect every other current owner. */
export const verifyTaskOwnershipAfterReconcile: WorkflowPostReconcileInvariant = (input) => {
  input.signal.throwIfAborted();
  const paths = execFileSync("git", [
    "diff", "--no-ext-diff", "--no-renames", "--relative", "--name-only", "-z",
    input.canonicalHead, input.head, "--", "data/tasks/",
  ], { cwd: input.workspaceRoot, env: withProtectedGitBareRepositoryEnv(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
    .split("\0").filter(Boolean);
  const changed = new Set(paths.filter((path) => path.endsWith(".md"))
    .map((path) => basename(path, ".md")).filter(isRepoTaskId));
  if (changed.size === 0) return { satisfied: true };
  if (!input.runEvidence) return { satisfied: false, reason: "Task publication requires current runtime ownership evidence" };
  const runs = input.runEvidence.listRuns();
  const publisher = runs.find((run) => run.id === input.runId);
  // Active runs have acquired their declared resources; queued successors wait for release.
  const owned = new Set(publisher?.state === "running" || publisher?.state === "integrating" ? publisher.resources : []);
  for (const run of runs) {
    if (run.id === input.runId) continue;
    const held = run.resources.find((resource) => resource.startsWith("task:") && changed.has(resource.slice(5)) &&
      !(run.state === "queued" && owned.has(resource)));
    if (held) return { satisfied: false, reason: `Task publication conflicts with ${held} owned by run ${run.id}` };
  }
  return { satisfied: true };
};

/** Domain validation and ownership compose with each workflow's semantic invariant. */
export function taskQueueIntegrationPolicy(options: Partial<WorkflowIntegrationPolicy> = {}): WorkflowIntegrationPolicy {
  return {
    validationCommand: options.validationCommand ?? taskQueueValidationCommand,
    postReconcile: (input) => {
      const ownership = verifyTaskOwnershipAfterReconcile(input);
      return ownership.satisfied ? options.postReconcile?.(input) ?? ownership : ownership;
    },
  };
}

import { nativeRunRepositoryAccess } from "#core/workflow/run-context.js";
import { mutateRepoTask } from "#modules/repo-tasks/repo-task-mutation-boundary.js";

/** Worker scenario keeps the synchronous CLI boundary off the host event loop. */
export async function completeTask(workspace: string, env: NodeJS.ProcessEnv) {
  const repositoryAccess = nativeRunRepositoryAccess(workspace, env);
  if (repositoryAccess === null) throw new Error("Writer identity is required");
  const target = { authority: "runtime-owned-sandbox" as const, repositoryAccess };
  await mutateRepoTask(target, {
    kind: "create", options: { title: "Authorized worker", priority: "p2" },
  });
  return mutateRepoTask(target, { kind: "move", id: "task-authorized-worker", state: "done" });
}

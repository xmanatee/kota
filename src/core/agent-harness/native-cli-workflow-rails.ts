export const WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION =
  "Treat Git metadata as read-only. Inspect Git state when useful, but do not run `git add`, `git commit`, or other commands that mutate Git metadata. Edit only task-scoped workspace files, write requested evidence and commit-message artifacts, and leave index staging, rebase continuation, commit creation, and publication to the workflow runtime.";

const WORKFLOW_AGENT_DAEMON_OWNERSHIP_INSTRUCTION =
  "Do not stop, restart, signal, or control the daemon process that launched you.";

/** Shared prompt rails for native CLIs whose tool loops run outside KOTA. */
export function buildNativeCliWorkflowRails(
  adapterInstructions: readonly string[] = [],
): string[] {
  return [
    "## KOTA workflow rails",
    WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
    WORKFLOW_AGENT_DAEMON_OWNERSHIP_INSTRUCTION,
    ...adapterInstructions,
  ];
}

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
    "Use a fresh subdirectory of $KOTA_RUN_TEMP_DIR, when supplied, for copied validation workspaces and generated output that must survive retries in this run. Otherwise use $TMPDIR for scratch confined to this invocation; it is removed when the invocation settles, including nested critic and repair calls. Keep selected results, command/source provenance and necessary small reproducers in the supplied $KOTA_RUN_DIR or $KOTA_RUN_ARTIFACT_DIR, or return them in your response when no output directory is supplied. Those output directories are recursively retained for review: do not put disposable source copies or compiled trees there. Run scratch is excluded from reviewer handoffs; runtime cleanup and retention own its lifetime.",
    ...adapterInstructions,
  ];
}

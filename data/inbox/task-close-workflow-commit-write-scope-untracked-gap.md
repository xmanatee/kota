# Close workflow commit/writeScope gap for untracked files

Recent audit found a mismatch between workflow write ownership and the final
commit step.

Evidence:
- `listMutatedTrackedFiles()` checks `git diff --name-only HEAD`, so untracked
  files are invisible unless already staged.
- `commitWorkflowChanges()` later runs `git add -A`, so unrelated untracked
  files can be swept into a workflow commit.
- The current test suite explicitly expects untracked files to be ignored by
  writeScope enforcement.

Desired direction:
- Treat untracked repo files as workflow-owned mutations before the commit step.
- Make the commit step stage only files that passed the workflow ownership gate,
  or make the ownership gate and staging command share the same path set.
- Keep scratch-artifact checks as a separate concern; they do not prove that
  every new file belongs to the running workflow.


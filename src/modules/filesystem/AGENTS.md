# Filesystem Module

This directory contains the filesystem capability pack — a repo module that owns all filesystem tools.

- This is the canonical home for file and directory tools. Do not add new filesystem tools to `src/core/tools/`.
- Tools, helpers, and tests are co-located here, following the pattern established by `web-access/`.
- Read-only tools (`file_read`, `glob`, `grep`, `files_overview`) are classified as safe in guardrails.
- Glob patterns stay within their selected base; choose a different `path` or
  `directory` instead of traversing through a pattern. Resolved matches that
  escape through a symlink are excluded.
- Write tools (`file_write`, `file_edit`, `multi_edit`, `find_replace`, `file_watch`) are classified as moderate.
- Editors preserve requested content, including unfinished syntax; final-result
  validation belongs to the publication workflow, not individual edits.
- Batch edits prepare final contents before writing. Write failures roll back
  only attempted files; report incomplete rollback and retain existing undo
  tracking for any files that could not be restored.
- Mutation tools reject the machine-authority directory supplied by the runtime;
  trust and policy changes must use the authenticated scope-authority service so
  they retain operator verification and audit provenance.
- Exact edits treat replacement text literally, including dollar signs. Regex
  substitution belongs to explicit regex mode in find-and-replace.
- Verify tool outcomes with scoped files and persisted contents. Kernel watcher
  lifecycle and credential-path resolution are verified beside their core owners;
  this module verifies tool routing and enforcement at each filesystem entrypoint.
- Read/list/search surfaces must not expose scope credentials, including the daemon ownership lock, or private conversation stores; use `#core/tools/protected-scope-paths.js` with the runtime's canonical scope and execution-directory context, including resolved aliases.
- Recursive content searches enumerate filenames and check resolved protection before invoking a nonrecursive content search. Filename exclusion flags alone cannot protect relocated stores or aliases.

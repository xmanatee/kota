# Filesystem Module

This directory contains the filesystem capability pack — a repo module that owns all filesystem tools.

- This is the canonical home for file and directory tools. Do not add new filesystem tools to `src/core/tools/`.
- Tools, helpers, and tests are co-located here, following the pattern established by `web-access/`.
- Read-only tools (`file_read`, `glob`, `grep`, `files_overview`) are classified as safe in guardrails.
- Write tools (`file_write`, `file_edit`, `multi_edit`, `find_replace`, `file_watch`) are classified as moderate.


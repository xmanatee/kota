# Execution Module

This directory owns the execution capability pack: shell commands, background
processes, code REPL, computer use, and screenshot tools.

- All tool implementations, helpers, and tests live here.
- This is a high-risk capability surface — treat changes carefully.
- Follow the `web-access/` and `filesystem/` directories as layout references.
- This module owns the shared Python/Node REPL lifecycle and wrapper protocol
  (`repl-session.ts`, `code-wrappers.ts`). `code_exec`, the core-hosted
  `custom_tool`, and manifest-code tool runners all share the same
  language-keyed REPL session singletons from this module. Core callers reach
  the capability through `#modules/execution/...` imports; do not add a
  re-export shim back under `#core/tools/`.

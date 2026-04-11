# Tools

This directory contains shared tool runtime primitives and the remaining
core-hosted tool implementations.

- Keep tool behavior explicit, well-scoped, and self-registering where
  possible.
- Do not treat `src/core/tools/` as the default home for every new capability. If a
  tool belongs to a cohesive project capability pack, prefer moving that pack
  behind a module boundary instead of growing this bucket further.
- Cross-cutting tool composition should stay readable; avoid hiding tool semantics inside unrelated runtime code.
- `repl-session.ts` manages persistent REPL sessions (Python, Node.js) used by
  custom-tool handlers, manifest execution, and the execution module's code-exec
  tool. It lives here because it is a shared tool runtime primitive, not a
  module-owned capability.


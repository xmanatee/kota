# Tools

This directory contains shared tool runtime primitives and the remaining
core-hosted tool implementations.

- Keep tool behavior explicit, well-scoped, and self-registering where
  possible.
- Do not treat `src/core/tools/` as the default home for every new capability. If a
  tool belongs to a cohesive project capability pack, prefer moving that pack
  behind a module boundary instead of growing this bucket further.
- Cross-cutting tool composition should stay readable; avoid hiding tool semantics inside unrelated runtime code.

## Key Modules

- `index.ts` — central core tool registry and dispatch surface (`getCoreRegistrations`, `getAllTools`, `executeTool`, `registerTool`, `getModuleToolRisk`, `getToolKind`). Tracks risk/kind metadata for module-registered tools in addition to core registrations. Only agent-protocol and runtime-control tools live here; general-purpose capability packs (filesystem, execution, web, git, system, etc.) belong in `src/modules/`.
- `runtime-check.ts` — `which` utility: checks whether a command exists on the system PATH; used by the execution module's `code_exec` tool.
- `custom-tool.ts` — `customToolTool` schema, `runCustomTool` dispatcher, `initCustomToolRegistry`, persistence lifecycle, and registration.
- `custom-tool-handlers.ts` — `handleCreate`, `handleList`, `handleRemove` action handlers and `buildRunner` execution builder for custom tools.

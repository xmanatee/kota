# Architect

This directory contains the architect-mode planning and execution flow.

- Keep plan/verify behavior explicit and testable.
- Favor protocol clarity over clever orchestration here because this logic shapes larger multi-step work.

## Key Modules

- `architect.ts` — `runArchitectPass`, `STREAM_MAX_RETRIES`, `streamBackoff`, `ArchitectOptions`; the planner pass that produces an execution plan.
- `architect-editor.ts` — `runEditorLoop`, `EDITOR_TOOL_SET`, `MAX_EDITOR_TURNS`, `EditorOptions`, `EditorResult`; the executor loop that carries out the plan using tools.
- `runner.ts` — `runArchitectStep`; orchestrates the architect + editor two-pass pipeline.
- `replan.ts` — failure tracking and replanning logic used by the editor loop.

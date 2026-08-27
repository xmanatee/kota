---
status: done
---

# Add workflow trigger dependency map to CLI

## Problem

KOTA's autonomy loop is a graph of workflows connected by bus events: the dispatcher emits events that wake the builder, explorer, or improver; workflows emit `workflow.completed` events that trigger digests; the builder emits `workflow.build.committed`. This graph is implicit in the workflow definitions but invisible to operators. Debugging why a workflow did or didn't fire requires reading source files or tracing event bus logs.

## Desired Outcome

`kota workflow deps` command that:
1. Loads all discovered workflows (same set used by `kota workflow list`).
2. For each workflow, reports: its name, the bus event(s) it listens to, any `filter` predicates that narrow the trigger, and any bus events it emits (detected from `type: "emit"` steps and known workflow-emitted events like `workflow.build.committed`).
3. Outputs a human-readable tree or table that shows the full trigger chain: which event → which workflow → which events emitted → which next workflows.
4. Optionally accepts `--format dot` to output Graphviz DOT format for rendering.

## Constraints

- Works offline; no running daemon required. Loads definitions via the module registry at startup.
- Emitted-event detection is best-effort from step definitions; dynamic emissions from agent step code cannot be statically detected.
- Command lives in the workflow module's CLI contributions, not in core.
- Output must be readable without `--format dot`; the DOT format is additive.

## Done When

- `kota workflow deps` lists all workflows with their trigger events and any declared emitted events.
- The trigger chain is visible: events that connect workflows are shown.
- `--format dot` produces valid Graphviz DOT output.
- Command is documented in `docs/WORKFLOWS.md` under the CLI reference section.

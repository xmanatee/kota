---
id: task-move-architect-mode-out-of-core-into-a-dedicated-m
title: Move architect-mode out of core into a dedicated module
status: ready
priority: p2
area: architecture
summary: Architect-mode is a specific two-pass planning capability gated by a boolean flag; it has ~1000 LoC in src/core/architect/ with one touchpoint in loop-send. Move it to a module so core stays protocol-oriented and the capability is optional.
created_at: 2026-04-19T18:55:53.085Z
updated_at: 2026-04-19T18:55:53.085Z
---

## Problem

`src/core/architect/` holds the two-pass plan-then-edit pipeline (~1000 LoC
across `architect.ts`, `architect-editor.ts`, `replan.ts`, `runner.ts`,
`retry.ts`, plus tests). It is consumed from exactly one place —
`src/core/loop/loop-send.ts` — behind a `state.architectMode` boolean that
flows from CLI flag through `loop-init.ts`, `loop-constructor.ts`, and
`loop.ts`. Architect-mode is a specific product capability, not a runtime
primitive: most sessions do not use it, it has its own editor model and
thinking config, and nothing in the agent/session protocol depends on it.

`docs/ARCHITECTURE.md` is explicit that "general-purpose capabilities should
not accumulate in the core by default" and that the core should mainly own
the agent/session loop, tool/module protocols, workflow runtime, daemon
control API, and store/provider contracts. Architect-mode does not fit any of
those. It is the same shape as the recent sqlite-memory, mcp-server,
semantic-index, and repo-tasks extractions: a capability pack hiding inside
core because it predates the module boundary.

Keeping it in core also leaks coupling: `loop-send` has to carry the
architect step, `AgentLoopState` exposes an `architectMode` bit, and any
change to the plan/edit protocol rides along with core releases even when it
is orthogonal to session loop semantics.

## Desired Outcome

Architect-mode lives in its own module (suggested: `src/modules/architect/`)
and plugs into the session loop through a typed extension point rather than
a hard-coded `if (state.architectMode)` branch. Core loses the
`architectMode` flag; the module owns its own opt-in path (session option,
config, or tool invocation — decided by whichever fits the existing extension
point shape). Removing the module fully removes the capability; no dangling
references remain in `src/core/`.

## Constraints

- No behavior change for existing architect-mode sessions. Verified by the
  existing `architect.test.ts`, `architect-editor.ts` tests, `replan.test.ts`,
  `runner.test.ts`, `tool-groups.integration.test.ts`, and
  `verify.integration.test.ts` passing after the move.
- Reuse an existing extension mechanism — a KotaModule-contributed pre-turn
  hook, a session variant, or a tool — rather than inventing a parallel
  registry just for architect-mode. Core must not keep hard-coded module
  names.
- Architect-mode must be contributed through the normal `KotaModule`
  contract. Declare dependencies (it imports from `#core/model`,
  `#core/loop`, `#core/tools`) through the KotaModule `dependencies` field
  where required.
- Update the CLI (`src/cli.ts`) and daemon-backed paths that enable
  architect-mode to route through the new module surface. Do not keep the
  old `architectMode` parameter name as a compatibility shim.
- Update `src/core/AGENTS.md`, `src/core/loop/AGENTS.md` (if it mentions
  architect), and the new module's local `AGENTS.md` in the same change.
- Do not widen the move to unrelated core-shrink work (data/, mcp/, server/).
  Each of those is its own decision.

## Done When

- `src/core/architect/` no longer exists; its code lives in a single module
  directory with its own `index.ts`, `AGENTS.md`, and tests.
- `src/core/loop/loop-send.ts` has no `runArchitectStep` import and no
  `state.architectMode` branch; the new extension point it goes through is
  generic, not architect-specific.
- `AgentLoopState` no longer carries an `architectMode` field, and no core
  file references the architect module by name.
- All existing architect-mode tests pass unchanged (or are moved alongside
  the code), and `pnpm test`, `pnpm typecheck`, `pnpm build`, and
  `pnpm run validate-tasks` pass.
- `src/module-deps.test.ts` still passes (runtime imports declared in
  module dependencies).
- The minimal-core/module-first guidance in the relevant `AGENTS.md` stays
  internally consistent after the move.

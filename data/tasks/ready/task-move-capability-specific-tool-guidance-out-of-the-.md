---
id: task-move-capability-specific-tool-guidance-out-of-the-
title: Move capability-specific tool guidance out of the core system prompt
status: ready
priority: p2
area: architecture
summary: Shrink the base KOTA system prompt back to core rails and move module-owned tool catalogs, workflow heuristics, and capability instructions to loaded-module prompt contributors or discoverable tool metadata.
created_at: 2026-05-19T20:02:43Z
updated_at: 2026-05-19T20:02:43Z
---

## Problem

`src/core/agents/system-prompt.ts` still acts as a broad capability catalog:
it names module-owned tools, workflow recipes, package-install recovery
patterns, memory/knowledge behavior, web/data pipelines, and orchestration
guidance directly from core. `src/core/agents/delegate-prompts.ts` has the same
shape for sub-agents, and `src/system-prompt.integration.test.ts` currently
pins the coupling by asserting the base prompt contains module tool names.

That makes the base prompt a parallel documentation surface for capabilities
that now live in modules. It can drift when modules are disabled, renamed, or
extended, and it weakens the architecture rule that core stays protocol-
oriented while modules contribute their own tools, prompt state, and guidance.

## Desired Outcome

The base KOTA prompt contains only durable core rails: agent identity,
instruction hierarchy/safety posture, general tool-use principles, concise
collaboration norms, and session-level recovery guidance. Capability-specific
instructions come from the owning module or from actual resolved tool metadata
for the tools admitted to the current session.

Agents should still receive enough guidance to use loaded capabilities well,
but the source of truth is no longer a hand-maintained, all-tools prompt in
`src/core/agents/`.

## Constraints

- Do not remove safety-critical guidance; move it to the owning module,
  dynamic prompt contributor, skill, or tool metadata surface.
- Do not add another global prompt catalog beside the current one. Prefer
  module-owned contributors and generated summaries from loaded tool metadata.
- Guidance must reflect the loaded and admitted tool set. A disabled module
  should not leave stale instructions in the base prompt.
- Keep prompts concise. Do not replace one giant core prompt with several giant
  injected blocks.
- Include sub-agent prompts in scope; `delegate-prompts.ts` should not keep a
  second hardcoded catalog of module-owned tools.
- Do not introduce compatibility aliases, optional fallbacks, or dual prompt
  paths to preserve the old catalog.

## Done When

- `src/core/agents/system-prompt.ts` no longer enumerates module-owned tool
  catalogs or capability-specific workflow recipes.
- Capability guidance for file, web, execution, memory, knowledge, notebook,
  sqlite, GUI, orchestration, and similar module-owned surfaces is either
  contributed by the owning module or generated from the resolved tool set.
- Sub-agent prompt assembly uses the same source-of-truth shape instead of
  hardcoded module tool lists.
- Tests fail if the base prompt reintroduces a module-owned tool catalog, while
  still proving common loaded capabilities remain discoverable to agents.
- Existing module dynamic-state contributors for capture/recall/answer/
  retract/working-memory continue to compose with the prompt without duplicate
  guidance.

## Source / Intent

Explorer run `2026-05-19T20-00-02-652Z-explorer-e03n51` found the queue empty
of actionable work while the strategic blocked alternatives were all honest
operator-capture waits. Code inspection then found a remaining module-first
boundary gap: the core session prompt still duplicates module capability
knowledge even though KOTA now has module-contributed dynamic prompt state and
loaded-tool discovery.

The watchlist's recent peer-runtime signals around skills, capability packs,
and discoverable agent guidance reinforce the same direction: keep capability
instructions close to their owning modules instead of force-feeding a global
catalog from core.

## Initiative

Module-first prompt ownership: KOTA's runtime prompt should explain core
protocol posture, while module-owned capability guidance travels with the
module that owns the capability.

## Acceptance Evidence

- `pnpm test src/system-prompt.integration.test.ts src/core/agents/delegate-prompts.test.ts`
  passes with assertions that the base prompt no longer hardcodes a module-
  owned tool catalog.
- Focused tests show at least file/web/execution guidance remains available
  when those modules are loaded and absent when they are not.
- `pnpm run validate-tasks -- --min-ready 0` passes.

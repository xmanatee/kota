---
id: task-make-imported-skills-resolvable-by-agent-skill-inj
title: Make imported skills resolvable by agent skill injection
status: ready
priority: p2
area: modules
summary: Close the gap between skill import and runtime skill use by loading local imported skills into the same explicit SkillDef resolution path with provenance and activation semantics.
created_at: 2026-05-18T03:39:09.506Z
updated_at: 2026-05-18T03:39:09.506Z
---

## Problem

`kota skill import` installs external or local markdown under `.kota/skills/`
and `kota skill list` surfaces those files as `source: imported`, but runtime
skill injection still resolves only `SkillDef`s contributed by loaded modules.
`ModuleLoader.getSkillsPromptFor(...)` reads from `state.skillContentsByName`,
which is populated only by `KotaModule.skills`; imported local files never enter
that resolver. The operator-facing command therefore implies an installed skill
can be used by agents while the agent prompt path silently ignores it.

That gap is becoming less theoretical. Peer ecosystems now encourage coding
agents to install reusable skill packs directly from external registries and
repos. If KOTA keeps import as a list-only side surface, operators cannot tell
whether an imported skill is inert, globally active, or explicitly selected.

## Desired Outcome

Imported skills are first-class, auditable entries in the same skill
resolution path that module-contributed skills use. A local skill installed
under `.kota/skills/` can be referenced by name from `AgentDef.skills`, appears
in `kota skill list` with enough provenance to review where it came from, and
is injected into agent prompts only through an explicit activation rule.

The activation rule must be visible and testable. Importing a remote skill must
not silently add untrusted prompt content to every agent that declares
`skills: "all"`; either imported skills require explicit agent names before
injection, or the implementation defines an equally explicit reviewed/enabled
state for inclusion in broad skill sets. Missing, malformed, duplicate, or
unreviewed imported skill data should fail loudly at the resolver boundary
instead of being silently dropped.

## Constraints

- Keep one skill registry/resolver. Do not add a second runtime skill store or
  a parallel prompt-injection path beside `SkillDef` and
  `ModuleLoader.getSkillsPromptFor(...)`.
- Keep imported-skill mechanics owned by `skill-ops` or the existing module
  load path; do not move unrelated agent or module concepts into
  `skill-ops`.
- Treat externally imported skill markdown as untrusted prompt content until
  the chosen activation rule makes the operator's decision explicit.
- Do not fetch remote URLs during module load or agent prompt assembly.
  Network access belongs to `kota skill import`; runtime resolution reads
  already-materialized local data.
- Preserve module-contributed skill precedence on name collision unless the
  implementation deliberately changes the collision rule and tests the new
  behavior.

## Done When

- `.kota/skills/*.md` files that pass validation become resolvable by the same
  runtime path as module-contributed skills.
- An agent whose `skills` list names an imported skill receives that skill in
  its prompt, and an agent that does not name it does not receive it.
- The behavior of `skills: "all"` with imported skills is explicit in code and
  tests; imported skills are not accidentally injected just because a remote
  file was downloaded.
- `kota skill list` distinguishes module-contributed and imported skills and
  shows the imported skill's usable/resolvable state plus source provenance
  when available.
- Invalid imported skill files fail with an actionable diagnostic instead of a
  silent omission.
- Existing module-contributed skills and role-scoped skill filtering continue
  to work unchanged.

## Source / Intent

Queue exploration on 2026-05-18 found an implementation gap while reviewing the
empty ready queue: `skill-ops` reads imported files for listing, but the module
loader's skill prompt resolver is populated only from `KotaModule.skills`.

External signal: the current CrewAI README advertises official coding-agent
skill installation commands (`crewaiinc/skills`, skills.sh-style install), and
Microsoft Agent Framework's current README lists "Agent Skills" as a production
capability. KOTA already has the import command; the missing local step is
making imported skills honestly usable without turning remote markdown into
hidden global prompt state.

Research links:

- https://github.com/crewAIInc/crewAI
- https://github.com/microsoft/agent-framework

## Initiative

Skill and module integrity: KOTA should have one clear, auditable mechanism for
reusable guidance, whether a skill comes from a shipped module or an operator
import.

## Acceptance Evidence

- Focused tests for imported-skill discovery, explicit agent selection,
  `skills: "all"` behavior, invalid local files, duplicate-name precedence, and
  role filtering.
- A CLI transcript or test fixture showing `kota skill import`, `kota skill
  list`, and a resolver-level prompt assertion for an imported skill.
- Existing skill tests still pass, including module-contributed skill injection
  and role-scoped filtering.

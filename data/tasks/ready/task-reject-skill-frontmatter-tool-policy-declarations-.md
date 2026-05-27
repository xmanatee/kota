---
id: task-reject-skill-frontmatter-tool-policy-declarations-
title: Reject skill frontmatter tool-policy declarations unless KOTA can enforce them
status: ready
priority: p2
area: core
summary: Fail loudly on allowed-tools and disallowed-tools metadata in local, imported, and remote skills unless a reviewed KOTA activation path maps it into the agent tool policy.
created_at: 2026-05-27T10:10:04.114Z
updated_at: 2026-05-27T10:10:04.114Z
---

## Problem

Peer agent runtimes now treat skill metadata as active tool policy. Claude Code
v2.1.152 added `disallowed-tools` frontmatter for skills and slash commands so a
skill can remove tools while it is active.

KOTA's current skill concept is guidance-only. `SkillDef` carries name,
description, prompt path, and role scope; agent tool policy lives on `AgentDef`.
Imported skill parsing currently reads `name`, `description`, and `roles` while
ignoring other frontmatter. That means a Skills.sh-style or Claude-compatible
skill that declares `allowed-tools`, `disallowed-tools`, or `tools` can import
successfully even though KOTA does not enforce the declared policy. Silent ignore
is unsafe because operators and future agents can reasonably read the metadata
as a security boundary.

## Desired Outcome

KOTA fails loudly on skill frontmatter that declares tool policy unless the
runtime deliberately maps that metadata into the existing agent/session tool
policy boundary.

The final behavior should cover module-local skills, imported skills under
`.kota/skills/`, and MCP-served remote skill reads or candidates. A skill with
unsupported security-sensitive tool metadata should not enter prompt resolution,
skill listing, or remote-skill display as if the declaration were honored.

## Constraints

- Keep one tool-policy owner: agents and sessions, not a second skill-specific
  permission system.
- Preserve imported-skill explicit-only activation and remote-skill untrusted
  handling.
- Do not execute hooks, scripts, or tool declarations found inside a skill.
- If the implementation chooses enforcement instead of rejection, it must use a
  typed protocol that composes with `AgentToolPolicy` and is visible in tests and
  operator surfaces.

## Done When

- Local/module skill loading rejects or explicitly handles `allowed-tools`,
  `disallowed-tools`, and equivalent `tools` declarations with a clear
  diagnostic.
- Imported skill install/list paths reject or explicitly handle the same
  metadata before the skill can be used in prompt resolution.
- Remote MCP skill list/read paths label or reject tool-policy metadata without
  implying it was enforced.
- Focused regression coverage proves unsupported tool-policy metadata is not
  silently ignored on each skill source path.

## Source / Intent

Explorer run `2026-05-27T10-07-34-326Z-explorer-h32edl` reviewed a thin queue
with one actionable task. The strategic blocked alternatives were considered,
but all still require operator-captured artifacts and are not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Fresh watchlist signal:

- https://github.com/anthropics/claude-code/releases

Claude Code v2.1.152, published on 2026-05-27, says skills and slash commands
can now set `disallowed-tools` in frontmatter to remove tools while active.
That is a concrete ecosystem signal that skill metadata is becoming an active
permission surface.

Local overlap check:

- `src/core/agents/agent-types.ts` defines `SkillDef` as guidance metadata and
  `AgentToolPolicy` on `AgentDef`.
- `src/core/modules/imported-skills.ts` imports only `name`, `description`, and
  `roles` from skill frontmatter.
- `task-consume-mcp-served-skills-as-explicit-remote-skill` already completed
  remote MCP skill discovery and required that remote skills not execute
  `allowed-tools` or similar declarations, but it did not close the local and
  imported skill metadata ambiguity.

## Initiative

Skill portability without authority confusion: KOTA should import ecosystem
skills while keeping tool access at the explicit agent/session boundary.

## Acceptance Evidence

- Focused unit tests for module skill loading, imported skill parsing/import,
  and remote MCP skill list/read behavior.
- Queue validation and the relevant `pnpm test` target pass with a fixture skill
  that declares `disallowed-tools`.

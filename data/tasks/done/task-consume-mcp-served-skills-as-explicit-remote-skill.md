---
id: task-consume-mcp-served-skills-as-explicit-remote-skill
title: Consume MCP-served skills as explicit remote skill candidates
status: done
priority: p2
area: core
summary: Teach the external MCP client path to recognize Skills Over MCP catalogs as remote skills with provenance, explicit activation, and resource-backed reads instead of leaving skill:// entries as opaque generic resources.
created_at: 2026-05-25T23:01:09.091Z
updated_at: 2026-05-25T23:18:02.000Z
---

## Problem

KOTA now has both halves of the Skills Over MCP direction, but they do not meet
on the host side:

- the first-party MCP server can expose KOTA's own skills as `skill://`
  resources through `resources/read`;
- the external MCP client path can list and read arbitrary remote resources;
- local and imported skills have explicit provenance and activation behavior.

A connected MCP server that implements SEP-2640 still appears to KOTA only as
generic resource operations. Its `skill://index.json` is not decoded as a skill
catalog, `skill-md` and `mcp-resource-template` entries are not surfaced as
remote skills, and an agent/operator has no skill-oriented way to inspect or
activate one without manually knowing resource URIs. That leaves MCP-served
skills below local/imported skills in discoverability even though they are the
same reusable guidance concept.

## Desired Outcome

KOTA consumes Skills Over MCP catalogs from connected external MCP servers as
explicit remote skill candidates.

The runtime should:

- detect servers that advertise `io.modelcontextprotocol/skills` and/or serve
  `skill://index.json`;
- parse the Agent Skills discovery index shape for concrete `skill-md` entries
  and parameterized `mcp-resource-template` entries;
- expose a skill-oriented list/read surface that includes remote provenance
  (`server`, `uri`, and whether the entry was enumerated or directly read);
- let an operator or agent explicitly read a remote skill by name or URI through
  `resources/read`, including sibling resources relative to the skill root;
- keep remote skill content as untrusted MCP resource output unless a later
  operator-reviewed activation state deliberately opts it into prompt
  resolution.

## Constraints

- Keep the external MCP client/manager protocol work in `src/core/mcp/`.
  The first-party MCP server remains module-owned.
- Reuse the existing skill concepts and skill-ops inspection surface where it
  fits. Do not add a second durable skill store or copy remote skill content
  into `.kota/skills/` automatically.
- Preserve imported-skill explicit-only behavior. Remote MCP skills must not
  silently enter `skills: "all"` or session system/developer prompt state.
- Use ordinary MCP Resources operations. Do not add custom MCP `skills/list` or
  `skills/get` protocol methods.
- Treat MCP-served skill markdown and bundled files as untrusted input. Do not
  execute scripts, hooks, `allowed-tools`, or other executable declarations
  from a remote skill.
- Fail loudly on malformed index entries, invalid `skill://` URI structure,
  duplicate names from the same server, broken relative references, and
  unsupported template reads.

## Done When

- `McpClient` or a focused sibling decoder can read `skill://index.json` and
  decode the Agent Skills discovery index with `skill-md` and
  `mcp-resource-template` entries.
- `McpManager` exposes explicit remote-skill operations for connected servers
  without colliding with generic remote resource operations or remote tools.
- A remote skill read returns bounded markdown/resource content plus provenance
  and never mutates local imported-skill state.
- Direct URI reads work even when enumeration is absent, and an absent or empty
  index is not treated as proof that the server has no skills.
- List-changed invalidation for remote resources refreshes the remote-skill
  catalog when the transport supports `notifications/resources/list_changed`.
- Retrieved remote skill content is returned as untrusted output and is not
  injected into higher-priority prompt state or automatically executed.

## Source / Intent

Explorer run `2026-05-25T22-59-47-817Z-explorer-c60c6n` reviewed a thin queue
with zero actionable tasks. The strategic blocked alternatives were considered
but all still require operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The never-seen watchlist entry
`https://github.com/modelcontextprotocol/experimental-ext-skills` is now
accessible. The Skills Over MCP WG describes the current problem as MCP servers
shipping tools without the structured guidance that teaches agents how to
orchestrate them. SEP-2640 is the current resources-based extension direction:
servers expose Agent Skills as MCP resources, optionally enumerate them through
`skill://index.json`, use `skill://<path>/<skill-name>/SKILL.md` for direct
reads, and advertise `io.modelcontextprotocol/skills`.

Local overlap check:

- `task-expose-kota-skills-over-mcp-resources` already completed KOTA's
  first-party server projection of local/imported skills over `skill://`
  resources.
- `task-expose-remote-mcp-resources-and-prompts-in-the-cli` already completed
  generic external MCP resource/prompt listing and reading.
- `task-support-skillssh-style-skill-pack-imports` and related imported-skill
  tasks already completed local skill-pack import and explicit runtime
  resolution.

Those tasks leave one nonduplicative host-side gap: recognizing remote
`skill://` catalogs as skills with provenance and explicit activation
semantics, not just as opaque resource URIs.

Research links:

- https://github.com/modelcontextprotocol/experimental-ext-skills
- https://raw.githubusercontent.com/modelcontextprotocol/experimental-ext-skills/main/docs/sep-draft-skills-extension.md
- https://modelcontextprotocol.io/community/skills-over-mcp/charter
- https://agentskills.io/specification

## Initiative

MCP protocol fidelity and skill portability: KOTA should use one skill concept
across local modules, imported packs, first-party MCP serving, and external MCP
consumption while keeping remote instructions at the correct authority level.

## Acceptance Evidence

- Focused MCP client decoder tests cover valid and malformed
  `skill://index.json` contents, direct URI-only skill reads, template entries,
  duplicate-name diagnostics, and absent-index behavior.
- MCP manager tests show a connected external server exposing remote-skill
  list/read operations with provenance while existing generic
  `mcp_resources__...` tools continue to work.
- A regression test proves remote skill content does not enter local
  `.kota/skills/`, `skills: "all"` prompt resolution, or system/developer
  prompt state.
- Existing MCP client/manager and skill-ops tests remain green, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts src/modules/skill-ops/skill-ops-operations.test.ts`.

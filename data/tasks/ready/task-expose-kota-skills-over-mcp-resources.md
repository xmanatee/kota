---
id: task-expose-kota-skills-over-mcp-resources
title: Expose KOTA skills over MCP resources
status: ready
priority: p2
area: modules
summary: Project KOTA's registered skill catalog through the first-party MCP server as skill resources, following the Skills Over MCP extension shape without creating a second skill registry.
created_at: 2026-05-25T21:25:23.666Z
updated_at: 2026-05-25T21:25:23.666Z
---

## Problem

The Skills Over MCP Working Group is converging on SEP-2640: serving agent
skills over MCP using the existing Resources primitive. KOTA already has the
two local halves of that model:

- skills are a first-class runtime concept (`SkillDef`) and are file-backed;
- imported Skills.sh-style packs preserve `SKILL.md` plus sibling resources
  under `.kota/skills/<name>/`;
- the first-party MCP server already exposes KOTA state through
  `resources/list`, `resources/templates/list`, `resources/read`, and
  `subscriptions/listen`.

Those pieces do not meet in the MCP server today. A client connected to
`kota mcp-server` can inspect tasks, workflow status, memory, knowledge,
prompts, tools, apps, and server-card metadata, but cannot discover or read
KOTA's registered skills as MCP resources. That leaves KOTA's reusable
guidance local-only even though MCP is becoming the distribution layer for
skills that explain how to use a server's tools.

The gap is not a new primitive request. SEP-2640 is explicitly resources-based:
skills are files, resources expose files, and `skill://index.json` is the
optional discovery index.

## Desired Outcome

KOTA's first-party MCP server projects the registered skill catalog through
the existing resource handlers:

- `skill://index.json` returns a bounded Agent Skills discovery index for the
  skills KOTA can enumerate.
- Every exposed skill has a stable `skill://<name>/SKILL.md` URI that can be
  read through `resources/read`.
- Imported directory skills expose their preserved sibling files under the
  same `skill://<name>/...` root, with path traversal blocked.
- Module-contributed skills that are file-backed but not stored as Agent
  Skills directories are exposed as generated `SKILL.md` resources whose
  frontmatter comes from `SkillDef` (`name`, `description`, roles/provenance
  only if the chosen shape keeps them explicit) and whose body comes from the
  existing `promptPath`.
- The server advertises `io.modelcontextprotocol/skills` only when the
  `skill://` resource projection is active.

## Constraints

- Reuse the existing `SkillDef` / imported-skill discovery path. Do not add a
  second skill registry, skill store, or MCP-only skill definition format.
- Keep the implementation in `src/modules/mcp-server/` and `skill-ops` /
  imported-skill helpers unless a shared type seam is genuinely needed.
- Use ordinary MCP Resources operations. Do not add custom `skills/list` or
  `skills/read` protocol methods.
- Do not add a one-tool-per-skill compatibility shim in this slice. KOTA
  should avoid inflating tool catalogs; a fallback for legacy clients can be a
  separate task if real client evidence demands it.
- Treat skill content as untrusted model input at the host boundary. Serving a
  skill over MCP must not execute scripts, hooks, or helper code embedded in a
  skill directory.
- Keep exact URI, index, extension-negotiation, and resource payload shapes in
  focused protocol tests rather than durable docs catalogs.

## Done When

- `resources/list` includes `skill://index.json` when at least one skill is
  enumerable, and `resources/read` returns a valid JSON index with concrete
  `skill-md` entries pointing at `skill://<name>/SKILL.md`.
- `resources/read` for a module-contributed skill returns markdown with
  Agent Skills frontmatter and the existing guidance body.
- `resources/read` for an imported directory skill returns the preserved
  `SKILL.md`, and a sibling resource such as `references/...` is readable
  through the same skill root.
- Invalid skill resource URIs, missing skills, attempts to read outside the
  skill directory, and malformed imported skill records fail loudly with
  protocol-shaped errors.
- Initialize / `server/discover` extension negotiation advertises
  `io.modelcontextprotocol/skills` only when the resource projection exists,
  and the server remains valid for clients that ignore the extension and see
  `skill://` entries as ordinary resources.
- Existing MCP resources, prompts, apps, tasks, sampling, logging, caching,
  and Streamable HTTP behavior remain unchanged.

## Source / Intent

Explorer run `2026-05-25T21-22-36-161Z-explorer-2c43ka` reviewed an empty
actionable queue. The strategic blocked alternatives were considered but still
require operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://modelcontextprotocol.io/community/skills-over-mcp/charter` says the
  Skills Over MCP Working Group defines how agent skills are discovered,
  distributed, and consumed through MCP, and names SEP-2640 as the current
  resources-based extension direction.
- `https://github.com/modelcontextprotocol/experimental-ext-skills` is the
  working group's experimental repository and states the current gap:
  MCP servers expose tools, but tools alone do not teach agents how to
  orchestrate them; skills provide that workflow guidance and should be
  discoverable with the server.
- `https://raw.githubusercontent.com/modelcontextprotocol/experimental-ext-skills/main/docs/sep-draft-skills-extension.md`
  defines `io.modelcontextprotocol/skills`, `skill://index.json`,
  `skill://<name>/SKILL.md`, resource-based reads, optional enumeration, and
  the explicit security posture that MCP-served skills are untrusted input and
  must not execute local code implicitly.

Local evidence:

- `src/core/agents/agent-types.ts` defines `SkillDef` as the single reusable
  guidance concept and makes it named, file-backed, and composable.
- `src/modules/skill-ops/AGENTS.md` and `src/core/modules/imported-skills.ts`
  keep imported skill packs as `.kota/skills/<name>/SKILL.md` plus preserved
  sibling resources.
- `src/modules/mcp-server/resources.ts` exposes tasks, workflow status,
  memory, knowledge, apps, and server-card resources, but no `skill://`
  resources.
- Repository search found no existing open task for Skills Over MCP,
  `io.modelcontextprotocol/skills`, or `skill://` resources.

## Initiative

MCP protocol fidelity and skill portability: KOTA should expose its existing
module-owned skills through the standard MCP resource surface current clients
are converging on, without turning skills into a second tool or registry
system.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- A fixture under `.kota/runs/<run-id>/` or a checked protocol fixture shows
  `initialize` / `server/discover`, `resources/list`, `resources/read
  skill://index.json`, `resources/read skill://<module-skill>/SKILL.md`, and
  `resources/read skill://<imported-skill>/references/...`.
- Existing skill import/list tests and MCP resource/prompt tests remain green.

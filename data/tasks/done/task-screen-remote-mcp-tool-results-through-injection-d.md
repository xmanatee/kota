---
id: task-screen-remote-mcp-tool-results-through-injection-d
title: Screen remote MCP tool results through injection-defense by provenance
status: done
priority: p1
area: modules
task_class: Safety
summary: Treat external MCP tool and resource results as content-ingest outputs for autonomous runs by default, so dynamically named mcp__server__tool results are screened through injection-defense without per-tool allowlist configuration.
created_at: 2026-06-21T04:39:36.410Z
updated_at: 2026-06-21T05:36:14.000Z
---

## Problem

KOTA's `injection-defense` middleware screens a fixed set of content-ingest
tool names by default: web fetch/search, HTTP request, read-document, and
browser text-ingest surfaces. The middleware can already screen MCP-shaped rich
blocks when a specific `mcp__server__tool` name is manually configured, but
external MCP tools are dynamically named per server and tool. That means a
newly connected remote MCP server can return prompt-injection text to an
autonomous agent without default injection-defense assessment unless the
operator has pre-listed each generated tool name.

This is the wrong trust boundary. Remote MCP output is externally authored
content, even when the server or transport is authorized. Tool-risk gating and
MCP schema validation decide whether a call may execute and whether its shape
is valid; they do not decide whether returned text has authority inside the
agent context.

## Desired Outcome

External MCP tool and resource results are screened through `injection-defense`
on autonomous runs by provenance, not by static exact tool names.

The default behavior should cover dynamically named external MCP tools such as
`mcp__github__get_issue`, remote resource read/list wrappers, and MCP-served
skill/resource outputs when those results enter agent context. Suspicious
payloads should receive the existing warning banner and
`injection.defense.assessed` event. Benign remote MCP results should remain
unchanged while still recording an assessment, matching the existing
content-ingest contract.

KOTA-owned local MCP shims, such as owner-question plumbing, should not be
reclassified by name alone. The implementation should use an explicit source or
provenance signal from the MCP manager/tool runner path, or an equivalent typed
predicate, so future MCP servers do not require hand-maintained
`targetTools` entries.

## Constraints

- Build on the existing `src/modules/injection-defense/` middleware and event
  shape. Do not add a parallel MCP-only injection scanner.
- Keep `targetTools` configuration working for operators who need explicit
  includes/excludes, but do not require per-server dynamic names for the common
  external MCP case.
- Preserve current MCP result validation, structured content preservation,
  `_meta` handling, input-required/task result handling, and secret masking.
- Do not drop remote content on suspicion. Annotate suspicious results and emit
  audit events, as the existing module does.
- Keep the detector cheap and structural. This task is about routing the right
  content through the existing detector, not adding an LLM classifier.
- Avoid over-screening internal KOTA control-plane outputs solely because their
  tool name starts with `mcp__`.

## Done When

- Default autonomous sessions screen external MCP tool results without listing
  each generated `mcp__server__tool` name in `modules.injection-defense.targetTools`.
- Remote MCP resource text and rich MCP content blocks are included in the
  screened text, preserving the current annotation behavior for both plain
  `content` and `blocks`.
- A focused test proves a suspicious dynamic external MCP result is annotated
  and emits `injection.defense.assessed`.
- A focused test proves a benign dynamic external MCP result is not annotated
  but still emits an assessment.
- A focused test proves an internal KOTA MCP/control-plane tool result is not
  swept in merely by the `mcp__` prefix, unless it is explicitly marked as
  external content-ingest.
- Existing injection-defense tests, MCP manager/tool-runner tests, and tracing
  security-log tests remain green.

## Source / Intent

Explorer run `2026-06-21T04-01-08-650Z-explorer-cci7cv` reviewed a thin
queue: one actionable p3 cleanup task, no backlog, and
`inspect-queue.strategicReadyCoverageGap=true`. The strategic blocked
alternatives all still require operator-captured evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://www.anthropic.com/engineering/how-we-contain-claude` ("How we
  contain Claude across products", published May 25, 2026) frames agent
  security around environment containment, model-layer defenses, and the
  external content an agent reads. Its KOTA-relevant warning is that MCP
  servers, plugins, web search, and other connectors can be trusted as software
  while still returning poisoned data, so tool output needs live inspection
  before it enters the model context.

Local overlap check:

- `task-add-injection-defense-on-web-derived-content-for-autonomous-mode` is
  done and shipped the middleware, but its default target set is static and
  centered on web/read-document/browser ingest tool names.
- The current injection-defense tests prove manually configured
  `mcp__...` tools and MCP resource blocks can be screened, but that is not the
  same as default coverage for dynamically discovered external MCP tools.
- MCP client work already treats remote payloads as untrusted external I/O for
  schema validation and explicit resource access; this task closes the
  agent-context screening gap instead of changing MCP protocol behavior.

## Initiative

Agentic security containment: external tool output should not gain authority
inside autonomous runs just because the connector itself was configured.

## Outcome

MCP-managed remote tools and resource/skill/prompt operations now attach
typed `external-mcp` result-content provenance before tool middleware runs.
`injection-defense` screens that provenance in autonomous sessions alongside
the configured exact-name target tools, while unmanaged MCP-shaped KOTA
control-plane names remain untouched unless they are explicitly marked as
external content.

## Acceptance Evidence

- Focused test transcript for `src/modules/injection-defense/` showing dynamic
  external MCP result screening, benign assessment emission, and internal MCP
  control-plane exclusion.
- Focused MCP/tool-runner test transcript showing the provenance signal reaches
  middleware for real MCP-manager executed tools.
- Tracing/security-log test or artifact showing `injection.defense.assessed`
  records are emitted for screened external MCP results without leaking raw
  payloads or secrets.
- `pnpm run validate-tasks` passes after the task is completed.

---
id: task-add-agentic-resource-discovery-over-kota-capabilit
title: Add agentic resource discovery over KOTA capabilities
status: ready
priority: p1
area: modules
task_class: Platform
summary: Expose a discovery surface that ranks existing tools, skills, modules, MCP servers, setup requirements, and knowledge entries for a task without creating a second resource catalog.
created_at: 2026-06-24T15:44:37.284Z
updated_at: 2026-06-24T21:44:22.350Z
---

## Problem

KOTA has many discoverable capability surfaces: module manifests, tools,
skills, named agents, workflows, channels, MCP registry imports, setup
requirements, knowledge entries, and recall. They are individually inspectable,
but an agent with a new goal still has to know which surface to query first.

The ARD article describes the general problem: agents need to identify, locate,
evaluate, and access resources dynamically instead of relying on preloaded or
hardcoded resource lists. Eve's connection model points at a related production
concern: resource readiness, auth, and access should be explicit and brokered
without exposing credentials.

KOTA should not add a marketplace or second catalog, but it does need a single
resource-discovery seam over the metadata it already owns.

## Desired Outcome

A module-owned resource-discovery surface ranks KOTA capabilities for a natural
language task or structured requirement. Results should explain:

- what kind of resource matched: tool, skill, agent, workflow, module, channel,
  MCP server/config, setup requirement, or knowledge entry;
- why it matched the request;
- whether it is ready, blocked by setup/auth, unavailable, or read-only;
- the risk/effect metadata for actions that can mutate external state;
- the owning module and canonical inspect path; and
- how an agent or operator should access it without bypassing existing
  guardrails.

This should be usable from at least one operator surface and one agent-callable
tool, both backed by the same provider.

## Constraints

- Do not create a separate resource catalog. Discover from live module
  summaries, tool definitions, skill metadata, `agent-ops`, `mcp-registry`
  config output, setup requirements, and existing knowledge/recall providers.
- Do not install, execute, probe, or trust external MCP packages during
  discovery. The `mcp-registry` module remains a config import surface.
- Do not expose secret values, OAuth tokens, connector URLs that are meant to be
  hidden, or private raw setup payloads.
- Resource selection is advisory. It may suggest a tool or setup requirement,
  but it must not automatically run mutating tools or satisfy auth.
- Ranking should be deterministic for identical inputs and metadata. If
  semantic search is optional, keep a keyword fallback with explicit
  degradation.
- Keep ownership out of core unless a narrow provider contract is needed for
  modules to register searchable resources.

## Done When

- A typed `ResourceDiscoveryProvider` or equivalent module-owned provider can
  query and rank first-party capabilities by task description.
- CLI/daemon/API and an agent-callable tool share the same result shape.
- Results include readiness/setup blockers, risk/effect metadata, owner module,
  and canonical inspect/access hints.
- Existing resource sources join through their owning surfaces; there is no
  hand-maintained registry file.
- Tests cover matching, deterministic ranking, setup-blocked resources,
  unavailable resources, mutating-tool risk rendering, secret redaction, and no
  accidental MCP install/probe behavior.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://aiagentsdirectory.com/blog/solving-the-ard-problem-in-ai-agentic-resource-discovery
- https://vercel.com/blog/introducing-eve
- https://vercel.com/docs/eve

Local mapping:

- `src/modules/mcp-registry/` imports MCP Registry metadata into strict KOTA
  config, but intentionally does not execute or probe registry packages.
- `src/modules/agent-ops/` owns reflective `kota agent` inspection.
- `src/modules/module-manager/` owns `kota module` inspection and scaffolding.
- `src/modules/recall/` already ranks knowledge, memory, history, tasks, and
  answer-history content, but not capability metadata.
- Tool risk/effect metadata already exists through `ToolDef` and guardrails.

## Initiative

Capability discoverability: agents should be able to find the right KOTA
resource without bypassing module ownership, setup, auth, or guardrails.

## Acceptance Evidence

- Focused test transcript for resource matching, ranking, readiness, and
  redaction.
- CLI or HTTP transcript under `.kota/runs/<run-id>/` showing a query such as
  "send a Slack approval" returning the Slack/channel/setup/tool candidates
  with risk and readiness details.
- Agent-tool fixture showing the same provider result consumed without running
  a mutating action.

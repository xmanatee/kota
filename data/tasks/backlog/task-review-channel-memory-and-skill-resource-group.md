---
id: task-review-channel-memory-and-skill-resource-group
title: Review channel, memory, and skill resources against KOTA module APIs
status: backlog
priority: p2
area: modules
summary: Revisit historical resources around Chat SDK adapters, channels, memory, ontology, and skill ecosystems to check whether KOTA's module APIs cover them cleanly.
created_at: 2026-04-11T01:49:31Z
updated_at: 2026-04-11T01:49:31Z
---

## Problem

The historical resource packet included Vercel Chat SDK adapters, Telegram
adapter patterns, Claude Code channels, skill ecosystems, OpenViking, markdown
knowledge graphs, ontology examples, and ClawHub memory plugins. KOTA now has
Telegram, Vercel adapter support, skill import, MCP resources, memory, and
knowledge modules, but it is not clear whether the shared module APIs are broad
enough to support these patterns without one-off special cases.

## Desired Outcome

Assess the current channel, skill, memory, knowledge, and adapter surfaces
against those resources. Identify whether KOTA needs small protocol
adjustments, new optional modules, better docs, or no further work.

## Constraints

- Do not make inbox or tasks more structured to solve an adapter problem.
- Prefer adapter compatibility and optional modules over copied external
  systems.
- Avoid paid hosted dependencies and lock-in as baseline requirements.
- Keep any follow-up task scoped to one concrete surface or gap.

## Done When

- Channel, skill, memory, ontology, and Chat SDK resource groups are accounted
  for against current KOTA APIs.
- Existing support is linked or described where it is already sufficient.
- Missing support is captured as focused follow-up tasks.
- Resources that are useful only as inspiration are recorded as such.

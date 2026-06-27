---
id: task-audit-agent-directory-legibility-against-eve-patte
title: Audit agent directory legibility against Eve patterns
status: ready
priority: p2
area: modules
task_class: Platform
summary: Compare KOTA's agent/module file layout with Eve's filesystem-first agent shape and close concrete legibility gaps without importing a new framework.
created_at: 2026-06-24T15:44:37.358Z
updated_at: 2026-06-27T05:55:37.336Z
---

## Problem

Vercel Eve's strongest design signal is not a new runtime for KOTA to adopt. It
is filesystem legibility: an agent directory tells a reader what the agent is,
what model it uses, what tools and skills it has, where it runs, how it connects
to services, and when it acts.

KOTA has the same concepts, but they are contributed through modules,
definitions, prompts, skills, workflows, channels, setup requirements, and
client inspection surfaces. A developer can inspect them, but the "what is this
agent and what can it do?" story may require hopping between module summaries,
agent inspect, prompt files, workflow definitions, setup requirements, and local
`AGENTS.md` files.

## Desired Outcome

Audit KOTA's agent and module inspection surfaces against the Eve
filesystem-first pattern, then close concrete legibility gaps. The improvement
should make KOTA's existing model easier to inspect without importing Eve or
changing KOTA's public primitives.

The finished work should answer, for a selected agent or module:

- what role/instructions it uses;
- model/default effort and harness posture where available;
- declared skills and prompt path;
- allowed tools and tool policy;
- workflows/channels/setup requirements connected through the owning module;
- auth/setup blockers; and
- where the source files live.

Prefer extending `kota agent inspect`, `kota module inspect`, or shared daemon
inspection payloads over adding another catalog.

## Constraints

- Keep `agent-ops` read-only and reflective. It must inspect loaded module
  state through existing summaries/client handlers, not maintain a parallel
  agent catalog.
- Keep module ownership intact. Do not reorganize modules into Eve's directory
  layout or add a second framework scaffold.
- Do not duplicate prompt contents into durable docs; link paths and show
  concise summaries where the source already exists.
- Do not expose secrets or raw connector credentials while showing setup/auth
  readiness.
- If the audit finds no material code gap, the task should produce a small
  documented no-op with evidence rather than churn.

## Done When

- An audit artifact compares KOTA's current agent/module inspection shape with
  Eve's agent-directory concepts and names the specific local gaps.
- At least one concrete gap is closed in a module-owned inspection surface, or
  the artifact proves no change is needed.
- `kota agent inspect` and/or `kota module inspect` can show the resolved role,
  prompt path, skills, tool policy, setup blockers, and owning module for a
  representative contributed agent without direct filesystem spelunking by the
  operator.
- Daemon-control and local-client inspection paths stay in sync.
- Tests cover local and daemon-backed inspection output and redaction.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://vercel.com/blog/introducing-eve
- https://vercel.com/docs/eve
- https://vercel.com/eve

Local mapping:

- `src/modules/agent-ops/` owns `kota agent list` and `kota agent inspect`.
- `src/modules/module-manager/` owns `kota module list` and
  `kota module inspect`.
- `docs/ARCHITECTURE.md` defines `agent`, `tool`, `skill`, `workflow`,
  `channel`, `module`, and `setup requirement` as KOTA's canonical concepts.
- `src/modules/autonomy/AGENTS.md` already records Eve-like external framework
  patterns as peer signals, not runtime replacements.

## Initiative

Inspectable agent architecture: KOTA contributors and operators should be able
to understand an agent's shape from one reflective surface.

## Acceptance Evidence

- Audit artifact under `.kota/runs/<run-id>/` comparing Eve concepts with KOTA
  inspection surfaces and naming the implemented gap.
- CLI transcript for representative `kota agent inspect` and/or
  `kota module inspect` output before/after the change.
- Focused tests for local and daemon-backed inspection result shape.

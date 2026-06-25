---
id: task-improve-long-running-work-continuity-surfaces
title: Improve long running work continuity surfaces
status: done
priority: p2
area: client
task_class: Product
summary: Improve operator-visible continuity for durable KOTA work by surfacing goals, memory diffs, artifacts, recurring checks, and remote unblock points through existing clients and run records.
created_at: 2026-06-24T15:44:37.255Z
updated_at: 2026-06-25T15:44:16.000Z
---

## Problem

The Codex-maxxing material frames Codex as a place where long-running work can
live: durable threads, steering, memory as reviewable files, browser/computer
surfaces, remote control, recurring wakeups, goals, and artifact review.

KOTA already has many of these primitives: daemon sessions, workflows,
schedules, owner decisions, approvals, memory/knowledge, run artifacts, shared
UI surfaces, CLI and clients. The operator experience is still fragmented. To
understand a long-running workstream, an operator often has to inspect tasks,
workflow runs, artifacts, owner questions, memory/knowledge updates, and client
status separately.

## Desired Outcome

Add one operator-facing continuity surface for durable KOTA work. It should
aggregate existing state rather than create a new runtime primitive. For a
selected scope/project, it should show:

- active or recent goals/tasks and their latest run status;
- open owner questions, approvals, and owner decisions that can unblock work;
- recent run artifacts worth reviewing, with links/ids to inspect them;
- memory or knowledge changes produced by recent work, including diff/review
  hints where available;
- recurring checks or schedules tied to the work; and
- the next concrete unblock point or "nothing needs attention" state.

The first useful slice may be a shared UI surface plus CLI transcript. It should
be visible through daemon-backed contracts, not direct filesystem scraping by
clients.

## Constraints

- Use the daemon control API, `KotaClient`, shared UI contribution protocol, and
  existing stores. Clients must not parse `.kota/` files directly.
- Do not add a second session runtime, thread store, or workstream database.
  Aggregate tasks, sessions, workflow runs, decisions, approvals, memory, and
  knowledge from their owners.
- Do not expose raw prompts, secrets, credential names beyond approved secret
  references, private connector payloads, or large unbounded artifacts.
- Product-facing client work must include rendered evidence, not only unit
  tests.
- Keep the surface concise enough for phone/desktop glance use. Deep inspection
  should link to existing run/task/detail views.

## Done When

- A shared daemon-backed continuity projection exists for a scope/project and
  is consumed by at least one operator surface.
- The surface shows recent work state, open unblock items, artifact links,
  memory/knowledge change hints, and recurring/scheduled follow-ups from
  existing stores.
- Empty, healthy, blocked, and failed states are distinct and operator-readable.
- Tests cover projection assembly, secret redaction, no direct client file
  reads, empty state, blocked state, and failed-run state.
- A rendered transcript, screenshot, or equivalent artifact proves the operator
  journey.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://openai.com/index/codex-maxxing-long-running-work/
- https://cdn.openai.com/pdf/8a9f00cf-d379-4e20-b06f-dd7ba5196a11/OAI_WhitePaper_Codex-maxxing26.pdf
- https://jxnl.co/writing/2026/05/10/codex-maxxing/

Local mapping:

- `docs/ARCHITECTURE.md` says clients are thin daemon-control consumers and
  sessions/workflows are the core execution record.
- `docs/STANDARDS.md` says product-facing client/operator work is complete only
  when the real operator journey is inspectable through rendered evidence.
- Existing shared UI surfaces, owner decisions, approvals, tasks, memory,
  knowledge, and run artifacts should be composed rather than replaced.

## Initiative

Operator continuity: long-running autonomous work should be easy to resume,
review, and unblock without reconstructing state from scattered files.

## Acceptance Evidence

- Added the daemon-backed `continuity` shared UI surface, consumed from
  `/ui/surfaces` after Inbox and built from typed `KotaClient` namespace reads.
- Covered projection assembly, secret redaction, no direct client `.kota`
  parsing, empty state, blocked state, and failed-run state in
  `src/modules/daemon-ops/operator-ui-continuity.test.ts`.
- Generated rendered evidence under
  `.kota/runs/2026-06-25T15-21-57-328Z-builder-05u3ok/`:
  `continuity-rendered-transcript.txt`, `render-continuity-fixtures.ts`, and
  `continuity-notes.md`.
- Validated with `pnpm lint`, `pnpm typecheck`, and focused daemon-ops Vitest
  coverage.

---
id: task-fixture-research-blocker
title: Fixture-only research blocker for research-retry replay coverage
status: blocked
priority: p3
area: research
summary: Synthetic blocked task with a plain-http resource so research-retry inspect-candidates selects it under a hermetic capability profile (no Playwright, no auth profile) and the replay adapter exercises the agent step end-to-end.
created_at: 2026-04-23T00:00:00.000Z
updated_at: 2026-04-23T00:00:00.000Z
---

## Problem

The research-retry workflow only invokes its agent step when
`inspect-candidates` finds a blocked task whose Resources block
includes at least one URL the current capability profile classifies as
readable. Production runs target X/Twitter posts that need Playwright +
an authenticated browser profile; a hermetic fixture replay cannot
satisfy either precondition. This synthetic blocker gives the workflow
something to pick under the empty-capability profile so the replay
adapter's recording is actually exercised.

## Desired Outcome

`inspect-candidates` selects this task as the candidate, the replay
adapter handles the recorded `retry` agent step, `mark-attempt` writes
the workflow's fingerprint marker into this task body, and the commit
step records the resulting changes.

## Constraints

- Keep at least one plain-http URL in the Resources block below so
  `classifyResourceUrl` returns `plain-http` and `isUrlReadable` stays
  true with `playwrightAvailable=false` and `authProfileExists=false`.
- Stay at `priority: p3` so this fixture-only task does not require a
  `## Initiative` section.
- Do not edit during a real autonomous run; this file lives only inside
  the eval-harness fixture tree.

## Done When

- The fixture's replay run reaches the commit step with `committed: true`.
- The post-run task body carries the `research-retry-attempt` marker
  `mark-attempt` writes from the candidate's URL fingerprint.

## Source / Intent

Authored alongside `research-retry-agent-call-replay` to satisfy the
research-retry workflow's `inspect-candidates` precondition under a
hermetic capability profile. Without a plain-http URL the workflow
short-circuits at `inspect-candidates`, retry never runs, and the
replay adapter is never exercised — defeating the regression-gate the
fixture exists to provide.

## Acceptance Evidence

The fixture's `pnpm test` run passes the smoke gate, and the fixture's
predicates verify that `mark-attempt.json` reports `written: true` for
this task id, that the post-run task body contains the
`research-retry-attempt` marker, and that the commit step succeeded.

## Resources

- https://example.com/research-retry-fixture-resource

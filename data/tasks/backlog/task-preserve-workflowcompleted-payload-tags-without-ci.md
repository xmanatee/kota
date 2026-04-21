---
id: task-preserve-workflowcompleted-payload-tags-without-ci
title: Preserve workflow.completed payload tags without circular corruption
status: backlog
priority: p2
area: core
summary: Stop queue persistence from serializing workflow.completed trigger payloads into lossy strings like trigger.payload.tags: '[Circular]' so downstream routing keeps typed arrays and objects after daemon restart
created_at: 2026-04-21T15:52:00.549Z
updated_at: 2026-04-21T15:52:00.549Z
---

## Problem

After an explorer run was interrupted, the persisted pending attention-digest
run's trigger showed `trigger.payload.tags: "[Circular]"` instead of an
array. That is queue persistence serializing a payload whose object graph
already contained a circular reference.

- Trigger payloads are part of the typed workflow protocol; they should
  survive persistence as plain data, not debug strings.
- Downstream workflows route and report on tags, so a `[Circular]` string
  silently changes behavior at replay time.
- Persisted queue state should be replayable after daemon restart without
  hidden shape corruption, and today it is not.

## Desired Outcome

`workflow.completed` payloads are composed as acyclic typed data and persist
that way through queue save / restore, including payloads captured from
interrupted runs.

- Payload construction does not embed references that can become circular
  (e.g. reusing the running workflow object as a payload field).
- Queue persistence uses a serializer that fails loudly on cycles rather than
  silently stringifying them.
- A regression test exercises a completed-workflow follow-up event through
  save and restore for both completed and interrupted producers, asserting
  `tags` is still an array.

## Constraints

- Do not paper over the symptom with a replacer that emits `[Circular]`
  placeholders; cycles in internal protocol data are a bug, not a case to
  normalize.
- Keep trigger-payload typing strict; no opaque any / unknown fallbacks at
  the persistence boundary.
- Recovery and replay semantics from the recovery contract must stay intact.

## Done When

- The upstream composer for `workflow.completed` payloads produces acyclic
  data even when a run is interrupted.
- Queue persistence rejects cycles in internal payloads with a loud error
  rather than writing `[Circular]`.
- A focused test covers save / restore of a completed-run follow-up event,
  including the interrupted-run path, and asserts tag shape.


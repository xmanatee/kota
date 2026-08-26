---
id: task-rewrite-dead-letter-handling-into-focused-lifecycl
title: Rewrite dead-letter handling into focused lifecycle components
status: done
priority: p2
area: architecture
task_class: Platform
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Separate dead-letter contracts, persistence, redrive, retention, and redaction behind one lifecycle service.
created_at: 2026-08-24T02:13:49.133Z
updated_at: 2026-08-26T15:21:34.392Z
---

## Problem

`dead-letter-queue.ts` combines all source/redrive record types, persistence,
deduplication, queries, mutation, workflow/event/action factories, retention,
redaction, and digests. This makes authorization, storage, and redrive policy
interdependent inside one nearly 1,000-line daemon file.

## Desired Outcome

Rewrite dead-letter handling as one lifecycle service composed from focused
contracts, a persistence store, record factories, redrive policy/execution,
retention, and evidence projection/redaction. The daemon and clients continue
to see one coherent queue and one set of transitions.

## Constraints

- Preserve durable restart recovery, idempotency, deduplication, source
  lineage, diagnostic evidence, and fail-closed redrive authorization.
- Do not create separate event, workflow, batch, and confirmed-action queues;
  variants share the same discriminated contract and store.
- Storage owns atomicity and record identity; redrive owns target validation;
  projection owns redaction. No component bypasses another's boundary.
- Characterize live and restored behavior before replacement and delete the
  mixed implementation when all callers move.

## Done When

- Contracts, persistence, factories, redrive, retention, and projection each
  have one focused owner behind a single dead-letter lifecycle service.
- Live failure recording, duplicate suppression, dismiss, diagnostics,
  simulation/original redrive, restart, and retention behave consistently.
- Scope authorization and evidence redaction are tested at their exact
  boundaries.
- No parallel queue or compatibility facade remains.

## Source / Intent

Owner-approved targeted rewrite from the 2026-08-24 architecture audit. The
rewrite is justified by mixed lifecycle ownership, not file length alone.

## Initiative

Recoverable daemon state with focused lifecycle ownership.

## Acceptance Evidence

- Live/restart integration matrix for all dead-letter source and redrive
  variants, including duplicates and retention.
- Authorization and redaction boundary fixtures.
- Structural report proving one store/service path and removal of the mixed
  implementation.

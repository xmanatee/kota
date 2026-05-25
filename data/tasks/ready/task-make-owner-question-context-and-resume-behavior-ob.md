---
id: task-make-owner-question-context-and-resume-behavior-ob
title: Make owner-question context and resume behavior obvious to the owner
status: ready
priority: p2
area: modules
summary: Improve owner-question discovery/detail surfaces so the owner can see full context, source/run/task metadata, proposed answers, timeout behavior, and whether answering resumes a waiting workflow.
created_at: 2026-05-25T01:27:33.009Z
updated_at: 2026-05-25T01:28:18Z
---

## Problem

Owner asked how they should know about open owner questions, whether enough
context is available, and whether automation resumes automatically after an
answer. Current implementation stores full `context` in `OwnerQuestionQueue`,
but the owner-facing surfaces do not make that context consistently visible:

- `kota owner-question list` prints pending questions but truncates context to
  160 characters and has no full-detail command.
- `kota owner-question history` focuses on status, question, answer, and
  dismissal reason; it does not show the original context, source, timeout, or
  resolution source.
- `owner.question.asked` events emitted by the queue include id, question,
  reason, and source, but not context, timeout/default behavior, or structured
  workflow/run/task metadata.
- Telegram and email notifications consume that event shape, so they send
  question/reason/source plus answer commands, but not the full context.
- Workflow-owned escalations created through `askOwnerSteps` resume after
  `owner.question.resolved`; interactive `ask_owner` records an answer without
  a suspended workflow to resume. That distinction is not obvious at the
  answer surface.

## Desired Outcome

The owner can discover pending questions from configured channels and CLI,
open one question, and see enough detail to answer responsibly: source
workflow/session, run id when available, task id when available, full context,
reason, proposed answers, timeout/default behavior, answer/dismiss commands,
and whether an answer will resume a waiting workflow.

Notifications should either include enough compact context directly or provide
a precise detail command/link that reveals the full context without requiring
manual `.kota/owner-questions/*.json` inspection.

## Constraints

- Keep `OwnerQuestionQueue` as the source of truth; do not add a parallel
  owner-question store.
- Preserve the existing answer paths: CLI/HTTP, Telegram inline buttons, and
  Telegram reply-to-message answers must continue to resolve through the same
  queue API.
- Be explicit about the two behaviors: `askOwnerSteps` waits and resumes;
  interactive fire-and-forget `ask_owner` does not have a suspended workflow.
- Avoid optional metadata shims that make absence ambiguous. If run id or task
  id is not available, the surface should say so plainly or the enqueue
  boundary should provide typed metadata.
- Keep notifications concise enough for the transport while still providing a
  deterministic route to full detail.

## Done When

- CLI has a full-detail path for a pending or resolved owner question without
  truncating the stored context.
- CLI history exposes enough original question metadata to audit why an answer
  or dismissal happened.
- Telegram and email owner-question notifications include either useful context
  directly or a precise command/link to the full-detail view.
- The owner-facing text distinguishes workflow-resuming `askOwnerSteps`
  questions from interactive `ask_owner` questions that only record the answer.
- Tests cover pending detail, resolved history detail, notification formatting,
  and answer/dismiss behavior continuing to emit `owner.question.resolved`.

## Source / Intent

Owner inbox capture
`data/inbox/task-review-owner-question-context-and-answering-ux.md` asked how
the owner should know about open owner questions, whether enough context is
available, and whether automation resumes automatically after an answer.

## Initiative

Operator trust in autonomous escalation: owner questions should be easy to
notice, answer, audit, and reason about without hidden workflow semantics.

## Acceptance Evidence

- CLI transcript under `.kota/runs/<run-id>/owner-question-detail/` showing
  list, full detail, answer or dismiss, and history output for a seeded question
  with long context and proposed answers.
- Rendered Telegram and email formatter fixtures or tests showing the updated
  owner-question notification body.

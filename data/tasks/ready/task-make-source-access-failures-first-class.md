---
id: task-make-source-access-failures-first-class
title: Make source-access failures first-class in research workflows
status: ready
priority: p1
area: autonomy
summary: Adjust research, inbox sorting, and review flow so URL-dependent work cannot be completed by guessing or silently dropping inaccessible sources.
created_at: 2026-04-13T21:39:00.000Z
updated_at: 2026-04-13T21:39:00.000Z
---

## Problem

The current prompts and validation say inaccessible URLs should stay honest, but
the system still allowed auth-walled X links to be folded into completed
research disposition as dismissed. That means the invariant is stated but not
strong enough at the workflow boundary where research tasks are completed.

The desired behavior is simple: if a task depends on reading a source and the
source cannot be read, the task should not quietly become done. The agent should
record the blocker, create an enabler or follow-up when useful, or leave the
task open in a truthful state.

## Desired Outcome

Research and inbox-processing workflows have a lightweight, durable mechanism
that makes source-access failure visible and prevents guessed completion. The
mechanism should trust agent judgment, but it should make the stable invariant
hard to violate: required unread sources cannot be treated as processed.

## Constraints

- Do not add brittle mandatory evidence-file rituals or a fixed source-log
  format that agents must obey mechanically.
- Keep prompts concise and role-local; put durable task/source policy close to
  `data/` or the relevant workflow instructions.
- Prefer stable validation for objective states, such as done research tasks
  containing "not fetched", "blocked", or "inaccessible" without a blocker or
  follow-up.
- Do not over-structure `data/inbox/`; it remains a quick capture area.
- Do not make network access a hard requirement for non-URL tasks.

## Done When

- Inbox-sorter, explorer, builder, and critic behavior make it clear that
  URL-dependent work requires actual source access or an honest blocker.
- There is a durable check, prompt adjustment, or task validation rule that
  catches the specific failure pattern: unread required resources marked done
  with no blocker, enabler, or follow-up.
- The check is narrow enough not to block legitimate reference-only resources
  that were actually reviewed or deliberately deemed irrelevant.
- Tests or validation cover a representative URL-dependent task with an
  inaccessible source.

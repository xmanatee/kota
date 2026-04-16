---
id: task-add-telegram-inline-buttons-for-owner-questions
title: Add Telegram inline answer/dismiss buttons for owner questions
status: done
priority: p2
area: modules
summary: Owner questions surface in Telegram today as text messages with CLI-command hints. Mirror the inline approve/reject buttons used for approvals so the owner can answer or dismiss a question with one tap from the chat.
created_at: 2026-04-16T08:37:29.917Z
updated_at: 2026-04-16T09:54:55.426Z
---

## Problem

`owner.question.asked` notifications in Telegram today render as a plain
Markdown message listing the question, reason, source, and the CLI commands
needed to answer or dismiss. The approval pipeline in the same module already
uses an inline keyboard (Approve / Reject buttons) and routes button presses
through `approval-callback-poll.ts` to the approval queue, editing the original
message on resolution. Owner questions should have the same one-tap UX —
especially for cases with `proposedAnswers`, where the owner's whole decision
is picking one of a short list.

## Desired Outcome

The Telegram owner-question notification includes inline buttons that resolve
the question without leaving the chat:

- One button per `proposedAnswer` when the question supplies them, capped to a
  reasonable row width (similar to how approvals lay out Approve / Reject).
- A `Dismiss` button that calls `OwnerQuestionQueue.dismiss()` with a source
  like `"telegram-inline"`.
- On button press, the message edits to reflect the outcome (answered with
  which answer, or dismissed) so the chat history stays coherent.
- The callback-handling poll should not race the existing approval poll — the
  two flows must either share a single `getUpdates` loop or use disjoint
  offsets so both prefixes are served without update loss.

## Constraints

- Do not touch the owner-question queue or review gate — this is purely
  channel-side rendering and callback routing.
- Free-form typed answers stay out of scope — only proposed-answer buttons and
  dismiss are supported. Richer inline input (reply prompts, bot conversations)
  is a separate follow-up.
- Reuse existing callback-poll infrastructure; do not spin up a second
  long-poll against Telegram's `getUpdates` with `allowed_updates:
  ["callback_query"]`.
- Respect the same inline-button row/column limits Telegram enforces.

## Done When

- Owner-question Telegram messages include per-proposed-answer buttons and a
  Dismiss button when the queue entry has proposed answers.
- Pressing a button resolves the queue entry with the corresponding answer (or
  dismissal) and edits the original message to show the outcome.
- A single callback-poll loop handles both approval and owner-question
  callbacks; no duplicated `getUpdates` polling.
- Tests cover the Telegram button layout, the callback-to-queue mapping, and
  the message edit after resolution.
- `docs/NOTIFICATIONS.md` documents the inline answering behavior under the
  Owner Questions section.

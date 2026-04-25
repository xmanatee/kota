---
id: task-support-free-form-telegram-chat-reply-answers-to-p
title: Support free-form Telegram chat-reply answers to pending owner questions
status: ready
priority: p2
area: modules
summary: Let operators answer pending owner questions with free-form text via Telegram chat reply (reply_to_message_id), so non-listed answers and clarifying details no longer require dropping to the kota CLI.
created_at: 2026-04-25T04:04:55.873Z
updated_at: 2026-04-25T04:04:55.873Z
---

## Problem

The askOwnerSteps recipe and the notification-delivery channel together
now route owner-question escalations from autonomous workflows to the
operator's Telegram chat reliably, and the inline keyboard already lets
the operator pick one of the question's `proposed_answers` or dismiss
the question (`src/modules/telegram/index.ts:buildOwnerQuestionKeyboard`,
`src/modules/telegram/callback-poll.ts:handleOwnerAnswerCallback`). What
the Telegram surface still does not support is a free-form text answer.
The bot's message poll routes every text message straight into the
interactive `AgentSession` for that chat
(`src/modules/telegram/bot.ts:111-115`); there is no `reply_to_message_id`
inspection, and the owner-question surface only ever sees one of the
listed proposed-answer strings or a dismissal.

In practice every owner-decision precondition produced by autonomy today
ships with a small `proposed_answers` list. The visible gap is that an
operator who wants to answer outside that list (e.g. "variant-a, but
only land follow-up (a) for now"), give a clarifying note, or answer a
question that has no proposed answers at all, must drop to
`kota owner-question answer <id> <text>` on a workstation. That breaks
the operator-from-Telegram flow that the recent notification-delivery
investment was supposed to close.

## Desired Outcome

When an operator replies in Telegram to the message that delivered an
owner-question notification, KOTA records the reply text as the answer
to that pending owner question instead of forwarding it to the
interactive agent session. The flow is:

- The Telegram channel keeps tracking the `(chatId, messageId)` of each
  owner-question message it sends (already done in
  `pendingOwnerQuestions: Map<string, PendingMessage>`).
- The message poll inspects `update.message.reply_to_message` and, when
  that points at a tracked owner-question message that is still
  `pending`, routes the reply through `OwnerQuestionQueue.answer(id,
  text, "telegram-reply")` and edits the original message into the
  resolved shape, mirroring the inline-button path.
- Resolved or dismissed questions release the binding so a later reply
  to the (now stale) message falls through to the interactive session
  instead of attempting to re-answer.
- The interactive-session message path is unchanged for any reply that
  is not bound to an open owner question.

## Constraints

- Preserve the existing inline-keyboard and CLI answer paths; this is
  an additional surface, not a replacement. Free-form replies coexist
  with proposed-answer button selection — the first resolution wins, the
  later one returns the standard "already resolved" response.
- Use the same `OwnerQuestionQueue` API the inline-button path uses
  (`getOwnerQuestionQueue().answer(id, text, source)`). Do not add a
  parallel queue surface, side channel, or per-channel answer store.
- Keep the source label (`"telegram-reply"`) distinct from
  `"telegram-inline"` and `"http"` so the queue's answer-source
  attribution stays usable.
- Honor `allowedChatIds` — replies from disallowed chats must not
  resolve owner questions, exactly like text messages today.
- Do not silently ignore an unmatched reply (one whose
  `reply_to_message_id` does not match a tracked owner-question
  message): fall through to the interactive session as a normal text
  message. This preserves the "ask Claude a clarifying follow-up about
  the question" use case.
- No new env vars or config keys. The capability is implicit in the
  existing Telegram channel.

## Done When

- A test exercises the chat-reply path end-to-end: a tracked
  owner-question message receives a `reply_to_message` update from an
  allowed chat, the queue records the answer with source
  `"telegram-reply"`, and the original Telegram message is edited into
  the resolved-answer shape.
- A second test confirms that a reply to an untracked message still
  routes through the interactive session as a regular chat message.
- A third test confirms that a reply from a non-allowlisted chat does
  not resolve the question.
- The `src/modules/telegram/AGENTS.md` operator-deployment section
  describes the chat-reply surface alongside the inline-keyboard and
  CLI surfaces at the conventions level (no field catalogs).
- `src/modules/owner-questions/AGENTS.md` notes that free-form answers
  flow through the same queue API and have a typed source label.

## Source / Intent

Recent done work made owner-question escalation a real autonomous
surface: pausable `await-event` step primitive
(`task-land-pausable-await-event-workflow-step-primitive-`),
`ask_owner` converted to await-event
(`task-convert-askowner-from-held-await-polling-to-await-`),
notification-delivery channel
(`task-land-notification-delivery-channel-so-autonomous-w`), and a
real-workflow askOwnerSteps demo
(`task-demo-askownersteps-in-a-real-autonomy-workflow-and`). The
notification path is now load-bearing for autonomy. The Telegram answer
path covers the listed-proposed-answers case but forces operators to a
workstation CLI for any other shape, which is a visible regression of
the "answer escalations from your phone" outcome the investment was
meant to deliver.

## Initiative

askOwnerSteps + notification-delivery hardening — closing the
operator-feedback loop end-to-end so escalations escalate, get answered
on the operator's primary surface, and unblock the autonomy run that
asked, regardless of whether the answer is one of the listed options.

## Acceptance Evidence

- Captured Telegram chat transcript (or a deterministic test harness
  artifact under the run directory) showing: KOTA delivers an
  owner-question message → operator replies with free-form text →
  message edits to "Answered: <text>" → the originating
  `await-event` step resumes and the workflow completes.
- The three tests named under Done When pass under
  `pnpm test --filter telegram`.
- A short note on the answer-source attribution in the
  owner-questions module covers `"telegram-reply"`.

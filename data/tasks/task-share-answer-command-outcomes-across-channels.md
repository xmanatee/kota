---
status: open
priority: p2
---
# Share answer-command behavior across Telegram and Slack

## Problem And Owner

At `ab2889452`, `telegram/status-commands.ts` and `slack-channel/commands.ts`
separately implement answer command validation, defaults, empty-result handling
and result presentation for `/answer`, `/answer-log` and `/answer-show`.
The answer capability already owns the underlying operations. Channel cleanup
removed repeated tests but left this production behavior duplicated.

## Outcome

Put genuinely shared request/result behavior beside the existing answer capability
and make the two adapters use it. Keep channel parsing, selected-scope authority,
formatting limits, segmentation and transport delivery with their channel owners.
Remove replaced branches and redundant result-matrix tests in the same change.
Choose a small typed function or existing service boundary, not a command DSL,
universal dispatcher or a configurable fixture interpreter.

## Acceptance

Both channels retain answer creation, list/detail lookup, defaults and truthful
failure/empty responses under their selected scope. Shared behavior has one
owning test suite; adapters retain only distinct delivery, parsing and denial
checks. Trace maintained consumers before deleting helpers. Show the production
and test simplification and representative command outcomes; merely moving the
same duplication into helpers or deleting tests is not completion.

Follow `docs/VERIFICATION.md`; no deletion quota applies to this task. Google's
[change-detector guidance](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)
supports replacing implementation mirrors, not removing distinct behavior proof.

---
status: done
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

## Outcome Evidence

The answer owner now supplies three typed chat reply functions for creation,
history listing and detail lookup. They own argument validation, the five-record
chat default, empty/not-found responses and existing domain rendering. Telegram
and Slack pass their selected client and parsed body, retaining scope authority,
transport delivery and channel output limits. Both duplicate validation/default
branches and the Telegram-only default export were removed. CLI and tool renderer
consumers remain intact. Scoped guidance now names this ownership.

Shared command behavior is verified once beside answer; repeated channel input
and limit matrices were removed. Adapters retain parsing/delivery checks, including
Telegram truncation and detail segmentation. Existing admission checks remain.

Validation: `pnpm check:fast` passed; 111 selected owner tests passed across the
answer owner, channel command adapters, Telegram selection, and Slack bot/socket
admission. The production-dispatcher probe captured 26 operator replies using real
answer provider/history persistence and controlled recall, synthesis and HTTP
ports. It checked cross-channel cited answers, stored detail, history, usage,
empty and each failure response; eight records landed only in selected scope B,
and an unbound Telegram chat wrote none. No live chat or model evaluation was
performed. The run's `answer-command-transcript.md` and `answer-command-probe.mjs`
retain the observed output and reproducible stimulus.

---
status: open
priority: p2
---
# Preserve Unicode across Slack and Telegram message boundaries

## Problem

Slack splitText and Telegram splitMessage hard-slice UTF-16 at their message limits. Valid input consisting of limit-minus-one ASCII characters followed by an emoji and another character yields two independently invalid Unicode message strings. Both maintained chat transports emit these bodies, and command paths reuse the same splitters. The duplicated rule requires coordinated correction.

Investigation: Assessed observation 9b39c76cb9899a65297c0dc2 at revision 787eae398432bb1189aa0f30830fca0ec2e3681f. The duplicate implements the same newline-aware segmentation in maintained Slack and Telegram chat transports and command delivery. A probe through production emit/flush methods demonstrated a shared defect: an emoji crossing either channel's default boundary produces two outbound message strings containing unpaired surrogates. Independent UTF-8 encoding replaces those surrogate halves. Actual vendor rendering or rejection remains unverified. Existing selected tests passed: 34 splitter/transport tests and 15 command tests, without covering this Unicode boundary. Leaving the code unchanged retains the defect; neither path is unused. Separate fixes are feasible, but a narrow shared segmentation primitive would give the identical boundary rule and regression proof one owner. Terminal rendering is unsuitable because its wrapping normalizes whitespace. Channel limits, typing, routing and send-failure behavior remain separate. Active-task and inbox scans found no overlapping ownership. Related archived command tasks explicitly retained channel segmentation and do not cover this defect; no terminal task is being reopened or credited as coverage. Supplied delivery incidents establish no causal connection, so no delivery issue supports this proposal. Earlier judgments and the other 22 unreviewed structural fingerprints remain unassessed by this decision. Parent mono guidance was inaccessible. No tracked files were changed.

Evidence:
- 9b39c76cb9899a65297c0dc2
- git:787eae398432bb1189aa0f30830fca0ec2e3681f
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- src/modules/slack-channel/AGENTS.md
- src/modules/slack-channel/client.ts
- src/modules/slack-channel/client.test.ts
- src/modules/slack-channel/commands.ts
- src/modules/slack-channel/commands.test.ts
- src/modules/slack-channel/bot.ts
- src/modules/slack-channel/channel.ts
- src/modules/slack-channel/index.ts
- src/modules/telegram/AGENTS.md
- src/modules/telegram/verification.md
- src/modules/telegram/client.ts
- src/modules/telegram/bot.test.ts
- src/modules/telegram/bot-session-runtime.ts
- src/modules/telegram/status-commands.ts
- src/modules/telegram/status-commands.test.ts
- src/modules/telegram/channels.ts
- src/modules/telegram/index.ts
- src/core/channels/channel.ts
- src/core/loop/transport.ts
- src/modules/rendering/AGENTS.md
- src/modules/rendering/layout.ts
- data/tasks/archive/task-share-semantic-read-command-outcomes-across-channels.md
- data/tasks/archive/task-extend-slack-channel-slash-command-parity-to-answe.md
- data/tasks/archive/task-add-telegram-answer-log-and-answer-show-commands-c.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t05-29-19-125z-archite-cd17718b642422a71d6f0494a21534e3e792822c4d75f8efeb268ee9fb37b494/agent/message-segmentation-review.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t05-29-19-125z-archite-cd17718b642422a71d6f0494a21534e3e792822c4d75f8efeb268ee9fb37b494/agent/message-segmentation-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t05-29-19-125z-archite-cd17718b642422a71d6f0494a21534e3e792822c4d75f8efeb268ee9fb37b494/agent/message-segmentation-probe.jsonl

## Desired Outcome

Long Slack and Telegram replies preserve Unicode scalar values across message boundaries while retaining existing channel limits, newline preferences and delivery behavior. Shared ownership is expected to prevent duplicate boundary repairs; that maintenance benefit is not yet measured.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- SlackTransport.flush for interactive Slack replies
- Slack commands.ts postReply for command responses
- TelegramTransport.flush for interactive Telegram replies
- Telegram status-commands.ts /answer-show delivery

Alternatives considered:
- Leave both implementations local and unchanged: retains the demonstrated defect.
- Correct both splitters independently: fixes behavior but duplicates the same boundary rule and its owning regression proof.
- Delete an unused path: inapplicable because both splitters have maintained production callers.
- Reuse terminal rendering wrapProse: unsuitable because it changes whitespace and implements terminal layout semantics.
- Harvest only the shared segmentation algorithm into a neutral channel primitive, with explicit limits supplied by each adapter.

Migration and retirement: Migrate both transports and command consumers to one segmentation implementation. Remove the replaced local algorithms and obsolete splitter exports or re-exports after tracing their consumers. Consolidate redundant pure splitter cases at the new owner while retaining adapter checks for actual limits, routing and failure behavior. Keep Telegram typing and attempt-all-chunks behavior, Slack fail-fast delivery, and command truncation policies with their current owners.

Common behavior: Split reply text into bounded, ordered chunks, prefer existing newline boundaries and avoid separating Unicode surrogate pairs.
Stable variation point: Each channel supplies its established message limit and retains its own delivery, typing, routing and error policy.
Canonical owner: A narrow provider-neutral segmentation primitive under src/core/channels, shared by the existing channel adapters.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Demonstrate through production transport and command boundaries with controlled external ports that well-formed input produces individually well-formed outbound message strings within each channel's existing limit. Include the retained emoji reproducer at both defaults, exact limits, newline boundaries and hard splits; verify content preservation subject to existing newline segmentation semantics. Preserve ordered delivery, empty-buffer behavior, Telegram continuation after a failed chunk and Slack error propagation. Run affected owner tests and pnpm check:fast. A controlled outbound transcript is sufficient; do not claim live vendor acceptance without observing it.

Show one production owner for segmentation and the Unicode boundary rule, direct maintained callers supplying their channel limits, retirement of both replaced algorithms, and removal of redundant pure-algorithm proof without weakening distinct transport checks. Avoid introducing a transport framework, new registry or configuration surface.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

---
status: done
---

# Keep channel tests at delivery, routing and transport boundaries

## Scope And Evidence

Own Telegram, Slack-channel, A2A-channel and webhook-channel verification and
direct support. Telegram retains 5,715 test LOC; its 1,816-line bot suite includes
an imitation AgentSession and numerous harness/module mocks. Slack-channel has
1,840 LOC. These are leads to inspect, not proof every mock is invalid.

## Required Outcome

Preserve actual inbound routing, authenticated scope choice, outbound delivery,
message segmentation, polling ownership, retry/cancellation and recovery reporting.
Move repeated session/module guarantees to their existing owners and keep channel
cases for adapter behavior. Use real domain owners with controlled transport
responses rather than an imitated agent/session lifecycle.

Do not erase failure/recovery assertions because they expose a product defect.
`task-report-retrying-channel-operations-through-shared-health` owns that known
health gap; consume its contract if integrated, and avoid a parallel fix.
Never start a second live Telegram polling consumer to test this cleanup.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. Publish channel-local
simplification, focused delivery/failure observations and test/support deltas.
No live message spam, channel protocol redesign or repeated full-daemon lifecycle
suite.

## Completion

Telegram and Slack bot fixtures now use real sessions, module loaders, scoped
stores and transports with controlled model/HTTP responses. Retained cases
observe delivered replies, authenticated routing, scope choice and switching,
voice input, busy replies, segmentation, polling ownership and failures.
The existing continuity and operation-health journeys remain authoritative for
restart/reset and repeated retry/recovery episodes. Webhook source cases were
consolidated around precedence, continuity, events and rejection. A2A's distinct
protocol/backend boundary cases were reviewed and retained unchanged.

Local frozen-recipe counts: test LOC 9,512 → 8,558 (-954); authored support
1,298 → 1,340 (+42). Production and exclusions unchanged. These are candidate
counts, not the parent's published aggregate result.

Validation passed `pnpm check:fast`, 235 channel owner tests, 13 scope/continuity
integration tests and eight operation-health integration tests. Twenty-two
unchanged A2A HTTP cases could not bind loopback in this sandbox (EPERM).
No live polling consumer or production message traffic was used. Run
`2026-09-12T14-17-42-055Z-builder-loqf76` retains the logs, behavior-family rationale
and counts in its agent summary. Runtime owns publication.

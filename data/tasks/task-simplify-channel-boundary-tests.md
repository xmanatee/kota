---
status: open
priority: p1
depends_on: [task-simplify-module-composition-tests, task-simplify-agent-loop-contract-tests]
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

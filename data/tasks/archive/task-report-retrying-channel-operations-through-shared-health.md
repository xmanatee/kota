---
status: done
---

# Observe retrying channel failures and recovery through shared health

## Observed Gap

The September 11 operational check found ten Telegram polling network/timeout
diagnostics in `.kota/daemon-managed-1787730296.err` after the September 10
19:44 UTC integration. The final log write coincided with full host wake at
00:24:14 UTC; macOS had slept intermittently since 22:56:32 UTC. Do not interpret
these untimestamped lines as ten independent code defects or prove an ongoing
outage from them. No new inbound reply was exercised.

The reporting gap is independently visible in the owning code:

- `src/modules/telegram/bot.ts` catches retrying startup/poll failures and calls
  `printTerminalDiagnostic`, without forwarding an operation-health observation.
- `channels.ts` reports `operationFailed` only when `bot.start()` rejects.
  Errors caught inside its long-running loop never reach that boundary.
- `pollHealthyReported` is set after the first successful `getUpdates` and never
  reset after failure. `onPollHealthy` therefore cannot report a later recovery.
- The canonical event journal ends at 19:44:23.900 UTC; the durable
  issue projection still dates to September 9. A paused health consumer is a
  separate admission problem: retry diagnostics also bypass its input entirely.

The archived autonomous-failure lifecycle and Telegram ownership tasks delivered
grouping, investigation ownership and duplicate-poller reporting. Preserve those
mechanisms; this task closes the retrying-operation observation gap, not a second
incident system or another general failure-lifecycle migration.

## Required Outcome

Use the existing module operation failure/recovery contract and canonical issue
authority for long-lived channel operations. Inspect existing HTTP telemetry and
channel lifecycle ownership before choosing the narrowest adapter; do not emit
the same failure from both transport and channel. Telegram is the concrete
reproducer, not a reason to add a provider-specific recovery workflow.

Retain attributable, redacted failure and successful-recovery observations while
retrying. Group recurrence through the existing issue reducer, not local task
creation or a new counter/store. Distinguish expected stop cancellation, host
suspension, transient network failure and terminal ownership/authentication
failure. Preserve existing retry policy and single update-stream ownership.
Do not restart a healthy daemon or generate repair tasks for ordinary sleep.

Recovery requires successful completion of the same operation after a failure;
token validation, adapter construction, a silence interval or an earlier healthy
poll is not proof. Subsequent failure/recovery episodes must remain observable.
Keep healthy steady-state reporting quiet. Do not infer a successful interactive
reply merely from a successful empty poll.

## Acceptance

- With a controlled HTTP port, exercise successful polling, repeated retryable
  failure, success, and recurrence through the production bot/channel owner.
  Observe one grouped issue lineage and meaningful recovery without duplicate
  investigations; use existing lifecycle tests for reducer behavior rather than
  cloning them for Telegram.
- Failed startup recovery and deliberate stop preserve their distinct meanings.
  A paused consumer retains attributable observations for normal replay; no
  ad-hoc investigation bypasses workflow admission.
- Replace the existing once-per-start health expectation with episode semantics.
  Preserve conflict ownership tests and secret redaction. No real second
  `getUpdates` consumer may be started against the production token.
- Show timestamped, scoped operator evidence that distinguishes channel started,
  retrying failure and verified recovery. Reuse existing health/log surfaces;
  remove obsolete callback/state behavior in the same change.

## Completed

The interactive channel now forwards caught startup and polling retries to the
shared scoped module-operation health boundary. A successful `getUpdates` request
reports recovery and rearms later episodes; steady successful polls stay quiet.
Failure identities accompany recovery observations so a paused reviewer can
consume the retained episode without depending on an already-projected issue.
Existing conflict deduplication, issue reduction and workflow admission remain
the owners of grouping and investigation. Deliberate cancellation is quiet,
verified host suspension is diagnostic, and authentication/ownership failures exit.

Validation: `pnpm check:fast`, production TypeScript compilation into the run
directory, 85 focused Telegram/module-health and existing issue/reviewer owner
tests, and eight controlled channel integration cases passed. The full build
command could not remove existing `dist` assets because of filesystem permissions;
a full packaged build is not claimed. The initial owner test log had temporary
transform-file errors and an assertion failure; a fresh run passed all 85 tests
without source changes. The journey covers repeated failure, recovery, recurrence, startup,
stop, conflict, suspension and authentication, including journal replay before
issue projection. Existing broader issue lifecycle/reconciliation journeys were
also attempted: two timed out identically with the changed and original source;
two reconciliation cases passed. Those timeouts are not claimed as passing proof.

Run `2026-09-11T04-24-50-952Z-builder-jlwt41` retains
`channel-health-operator-evidence.json` and `channel-health-operator-logs.jsonl`.
The operator probe used the production channel, real HTTP transport and retry
timers with an isolated scope and controlled dispatcher. Timestamped logs show
start, retrying failure and verified polling recovery with redacted credentials.
No production token was used, no daemon was restarted, and no interactive reply
was claimed from the successful empty polls.

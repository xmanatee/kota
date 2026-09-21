---
status: open
priority: p2
---
# Make uncertain calendar creation understandable and safely recoverable

## Observed Gap

Investigation `task-recover-calendar-creation-after-lost-response` completed at
`1274fb4b36c60a59b4c2854727e8fab8e3a5934e`. Controlled calls through production
Calendar, tool/approval, HTTP and persistence owners established that a provider
commit followed by a lost response returns the same generic error as no commit.
An explicitly approved repeat creates a second event. This is a local controlled
reproduction, not a deployed incident or evidence of automatic model retries.

The current Calendar schema and POST have no operation identity. Read-only
listing helps inspect events but title/time cannot identify the original
operation. A 200 invalid JSON response becomes a null-property error; an empty
object reports `Event created` with `ID: undefined`. A queued approval projects
failed execution with redacted output after a lost response; resolving that same
approval twice is rejected, but a new request has no linkage to the first event.

Local idempotency, when supplied an explicit unadvertised key and store, replays
the recorded result including an error. Declarative workflow effects already
fail closed on unresolved effects. Neither mechanism establishes provider truth.

## Desired Outcome

After a Calendar create receives no usable response, the user can understand
whether the event is confirmed, was not submitted, or remains uncertain, and has
a safe supported way to reconcile and complete that same authorized operation.
A deliberate second meeting with identical details remains possible. Recovery
must not turn another user's, scope's or calendar's event into success.

## Acceptance

- Expose honest outcome and recovery guidance for pre-submission failure,
  uncertain completion and verified completion. Do not report creation from an
  unusable success body or imply a failed transport means no event exists.
- Preserve operation identity across supported authorized repeats/recovery,
  without deriving it only from meeting fields. Reuse the existing tool,
  approval, scope and persistence owners; account for both inline approval and
  queued approval execution rather than assuming they share local result replay.
- Reconcile an uncertain operation against the intended provider event before
  claiming success. A collision or matching title/time alone is insufficient.
  Conflicting parameters, unavailable reads and unresolved outcomes remain
  explicit. Local retention expiry must not silently authorize duplicate work.
- Keep authorization and scope boundaries intact. An intentional second event
  has distinct identity; an unauthorized repeat issues no write. Do not add
  automatic unkeyed POST retries, a second store or a second approval mechanism.
- Retain a controlled user-facing/runtime journey demonstrating safe recovery
  after a committed write loses its response, the no-commit case, malformed
  success, parameter conflicts and deliberate duplicate-looking meetings.
  Test the changed owners proportionately. Live Calendar writes are unnecessary.

## Evidence and Design Context

Builder run `2026-09-21T07-13-28-038Z-builder-mkxjpv` retains
`calendar-recovery-findings.md`, `calendar-recovery-probe.mjs` and
`calendar-recovery-transcript.json`: eleven controlled scenarios plus sixty
passing maintained owner tests. The archived investigation contains the source
trace and limits. Existing owners include `src/modules/google-workspace`,
`src/modules/approval-queue`, tool idempotency and workflow durable effects.

Google's [create guide](https://developers.google.com/workspace/calendar/api/guides/create-events)
recommends client-generated event IDs for failures after backend creation. Its
[event reference](https://developers.google.com/workspace/calendar/api/v3/reference/events#id)
defines calendar-local ID constraints and limits collision detection guarantees.
Both were read online September 21, 2026. Provider identity and verification are
promising implementation options, not an exactly-once guarantee. No Microsoft
integration or general-purpose retry redesign is part of this outcome.

---
status: done
---
# Can calendar creation recover safely when its response is lost?

Explorer research lead, September 21, 2026. No duplicate event or deployed KOTA
failure was observed; this is an unresolved product question.

Google's [create-events guide](https://developers.google.com/workspace/calendar/api/guides/create-events)
recommends a client-supplied event ID to prevent duplicates when creation succeeds
but the operation subsequently fails. Its [event resource reference](https://developers.google.com/workspace/calendar/api/v3/reference/events#id)
defines calendar-local ID requirements and cautions that distributed collision
detection is not guaranteed. Microsoft Graph instead exposes a client-supplied
[`transactionId`](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
specifically for redundant create requests after a lost response. These primary
sources were read online today. They suggest provider-aware recovery, not an
exactly-once guarantee or a reason to add Microsoft integration.

At `723307cd734189916a53172d059014e426364dc7`, KOTA's
`src/modules/google-workspace/calendar.ts` creates an event without supplying a
Google event ID; its declared input also lacks an operation identity.
`auth.ts` submits the POST without an HTTP idempotency key. Existing
`src/core/outbound-http/retry.ts` correctly classifies such POSTs as ineligible
for retry. Separately, `tool-idempotency.ts` and `tool-runner-idempotency.ts`
support local result replay when an explicit `idempotencyKey` and store are
available. This source trace does not establish the full session, approval or
workflow recovery behavior, or that KOTA automatically retries the write.

Question worth resolving: after an authorized create request receives no usable
response, can the user learn whether their meeting exists and complete the same
request without another event? First inspect maintained evidence and trace the
actual supported invocation through approval, execution and recovery. Existing
fail-closed handling may already be adequate. If a comparison is useful, use
controlled HTTP outcomes through production owners to distinguish failure before
submission, uncertain completion, and a known completed result; distinguish a
retry of one operation from an intentional second meeting with identical fields.
Do not infer identity solely from title and time, or treat a collision as success
without checking the intended event. Preserve scope and authorization.

Archived `task-add-generic-idempotency-and-dedupe-protocol` owns the shared
primitive; `task-consolidate-core-workflow-runtime-verification` records
fail-closed ambiguous-effect coverage. Reuse and assess those owners before
proposing changes. Google Workspace creation/inbound tasks and the recently
completed calendar pagination task address different boundaries. At triage, no other active task
or inbox item owned this specific question. No new store, retry loop, permanent
fixture, live calendar write or additional approval step is prescribed. An
evidence-grounded no-change disposition is a valid result.


## Research Outcome And Acceptance

Resolve whether the supported calendar-create journey lets a user understand
an uncertain result and safely complete the same authorized request. This is a
p3 investigation because the capture establishes a question, not an observed
incident; no external prerequisite prevents source tracing and controlled local
validation.

- Trace the supported invocation through approval, execution, result reporting
  and recovery, assessing maintained idempotency and ambiguous-effect evidence
  before proposing changes.
- Retain an inspectable user-facing transcript or equivalent runtime evidence
  showing what the user learns and can safely do after a lost response. Separate
  observed behavior from untested paths and provider guarantees from inference.
- Establish how existing behavior distinguishes failure before submission,
  uncertain completion and known completion, and retrying one operation from an
  intentional second event with identical fields. Controlled HTTP outcomes may
  supply missing evidence without a live calendar write.
- Record an evidence-grounded disposition: existing behavior is adequate with
  stated limits, or a concrete gap merits a scoped follow-up. This task does not
  presume an implementation change or require a new recovery mechanism.

## Triage Provenance

Normalized from `data/inbox/task-recover-calendar-creation-after-lost-response.md`
on September 21, 2026. The source question, repository revision and constraints
above are preserved. Triage re-read the Google creation guide, insert reference,
event resource reference and Microsoft event resource documentation; the ID
constraints citation now points directly to Google's event resource. No live
calendar write or end-to-end recovery probe was performed during triage.

## Investigation Disposition

Completed at source revision `1274fb4b36c60a59b4c2854727e8fab8e3a5934e` in
builder run `2026-09-21T07-13-28-038Z-builder-mkxjpv`. The research question is
resolved: current handling contains automatic replay but does not let the user
reliably identify and complete the same uncertain calendar operation. A concrete
module-owned follow-up is `task-make-calendar-create-outcomes-recoverable`.
No production code changed and no live calendar event was created.

Eleven controlled scenarios used the production tool runner, approval binding and
queue, Calendar adapter, HTTP transport and idempotency store. Before-submission
token failure issued zero calendar POSTs. No approval or a denied approval also
issued zero POSTs. Lost responses before and after a controlled provider commit
returned the identical network error. HTTP marked both unkeyed POSTs ineligible
for retry. An explicitly approved repeat created a second event in the committed
case. Intentional identical meetings followed the same path; no operation
identity distinguishes them. Read-only listing exposed the controlled event but
cannot establish operation identity from title/time alone.

Valid success reported an ID/link. Invalid JSON produced a null-property error;
a 200 empty object misleadingly reported creation with `ID: undefined`. The
queued approval path projected failed execution with redacted output and rejected
reuse of its resolved approval, but did not establish whether Google committed.
Diagnostic, unadvertised explicit keys replayed both success and error results
after reopening the local store and rejected changed parameters. Error replay
contains writes without recovering provider truth; keys are not sent to Google.

Existing declarative-workflow durable-effect tests passed: settled results replay
and unresolved writes fail closed with needs_attention. This protection is not
calendar reconciliation. Source tracing also found the preserved-conversation
warning against replaying unanswered calls; a completed error-result path is
different. No model retry, full client rendering or session restart is claimed.

Retained run artifacts: `calendar-recovery-findings.md` (source trace, provider
citations, disposition and limits), `calendar-recovery-probe.mjs` (reproducer),
`calendar-recovery-transcript.json` (actual results, approvals, HTTP telemetry and
controlled provider ledger), and `focused-verification.log` (60 tests across five
owner suites). These are under the run artifact directory. The first broad test
invocation was unintentionally unfiltered and interrupted after failures; its
incomplete log is retained and is not claimed as passing. The focused suites and
controlled boundary evidence are the acceptance proof for this investigation.

`pnpm check:fast` passed (production/test typechecks, lint, task validation,
client binding checks and admission of 90 bundled modules). No source or client
contract was changed. `git diff --check -- data` also passed.

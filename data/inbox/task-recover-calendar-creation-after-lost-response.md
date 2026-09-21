# Can calendar creation recover safely when its response is lost?

Explorer research lead, September 21, 2026. No duplicate event or deployed KOTA
failure was observed; this is an unresolved product question.

Google's [create-events guide](https://developers.google.com/workspace/calendar/api/guides/create-events)
recommends a client-supplied event ID to prevent duplicates when creation succeeds
but the operation subsequently fails. Its [insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
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
completed calendar pagination task address different boundaries. No active task
or inbox item owns this specific question. No new store, retry loop, permanent
fixture, live calendar write or additional approval step is prescribed. An
evidence-grounded no-change disposition is a valid result.

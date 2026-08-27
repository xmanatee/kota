---
status: done
---

# Security review: Outbound HTTP URL redaction preserves fragments verbatim. Credentials placed in fragments, such as OAuth access_token values, consequently reach transport telemetry, typed failures, and agent-visible web tool errors.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/outbound-http/redaction.ts
claim:

> Outbound HTTP URL redaction preserves fragments verbatim. Credentials placed in fragments, such as OAuth access_token values, consequently reach transport telemetry, typed failures, and agent-visible web tool errors.

## Desired Outcome

> Remove URL fragments before any telemetry or error projection because fragments are never transmitted in HTTP requests. Add regression coverage proving fragment credentials cannot appear in request-started/request-failed telemetry, OutboundHttpFailure, error messages, or web tool results.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-01T18-16-04-647Z-security-review-ievpd0.

finding id: outbound-http-url-fragment-secret-leak
candidate id: auth-approval-boundary:src/core/outbound-http/redaction.ts:1
verdict: confirmed
rationale:

> redactOutboundHttpUrl sanitizes credentials and sensitive query parameters but leaves URL.hash intact. The transport projects that URL into request telemetry, failure records, and OutboundHttpError messages; web-access tools return target-denied messages directly. Fragment credentials can therefore reach durable or agent-visible output.

Evidence:

Evidence 1:

path: src/core/outbound-http/redaction.ts

line: 24

excerpt:

> The redactor replaces URL username, password, and sensitive query parameters, then returns url.toString() without clearing or sanitizing url.hash.

Evidence 2:

path: src/core/outbound-http/transport.ts

line: 259

excerpt:

> The preserved URL is stored in OutboundHttpFailure, emitted through request-failed telemetry, and interpolated into the OutboundHttpError message.

Evidence 3:

path: src/modules/web-access/http-request.ts

line: 250

excerpt:

> Target-denied OutboundHttpError messages are returned directly as tool-result content.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/outbound-http/transport-errors.test.ts src/modules/web-access/http-request.test.ts` — passed (2 files, 88 tests).
- `pnpm test src/core/outbound-http` — passed (4 files, 21 tests).
- `./node_modules/.bin/tsc --noEmit` — passed.

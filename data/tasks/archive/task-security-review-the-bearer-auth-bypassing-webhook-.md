---
status: done
---

# Security review: The bearer-auth-bypassing webhook route still accepts body-only and bare-hex HMAC signatures with no timestamp. A captured signed request therefore remains cryptographically valid indefinitely and can trigger the workflow again after the seven-day idempotency record expires.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route-auth.ts
claim:

> The bearer-auth-bypassing webhook route still accepts body-only and bare-hex HMAC signatures with no timestamp. A captured signed request therefore remains cryptographically valid indefinitely and can trigger the workflow again after the seven-day idempotency record expires.

## Desired Outcome

> Require timestamp-bound `sha256-v2` signatures on the public webhook route and remove body-only and bare-hex acceptance. Continue using delivery idempotency as defense in depth rather than as the replay-authentication boundary.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T11-24-39-395Z-security-review-h4mafq.

finding id: webhook-body-only-signature-replay
candidate id: auth-approval-boundary:src/core/daemon/AGENTS.md:41
verdict: confirmed
rationale:

> src/modules/webhook/trigger-route-auth.ts:29-35 and :97-102 accept sha256= and bare-hex body-only signatures without timestamps. src/modules/webhook/trigger-route.ts:133-139 applies freshness checks only to timestamped signatures while :201 bypasses bearer authentication. Idempotency expires after seven days at src/core/daemon/idempotency-store.ts:89-92 and permits fresh reservation after expiry at :156-160. Existing route tests explicitly confirm body-only and bare-hex acceptance.

Evidence:

Evidence 1:

path: src/modules/webhook/trigger-route-auth.ts

line: 29

excerpt:

> if (trimmed.startsWith(BODY_ONLY_SIGNATURE_PREFIX)) {

Evidence 2:

path: src/modules/webhook/trigger-route-auth.ts

line: 35

excerpt:

> return { scheme: "body-only", hex: trimmed };

Evidence 3:

path: src/modules/webhook/trigger-route-auth.ts

line: 97

excerpt:

> if (parsed.scheme === "body-only") {

Evidence 4:

path: src/modules/webhook/trigger-route.ts

line: 134

excerpt:

> verification.scheme === "timestamped" &&

Evidence 5:

path: src/core/daemon/idempotency-store.ts

line: 91

excerpt:

> durationMs: 7 * 24 * 60 * 60 * 1000,

Evidence 6:

path: src/core/daemon/idempotency-store.ts

line: 159

excerpt:

> if (existing?.status === "expired") {

Evidence 7:

path: src/core/daemon/idempotency-store.ts

line: 160

excerpt:

> return this.createReservation(input, now);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Final Verification

- `NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run src/modules/webhook --configLoader runner --silent=true` — 10 test files and 116 tests passed, including explicit rejection of body-only `sha256=<hex>` and bare-hex signatures.
- `node_modules/.bin/tsc --noEmit` — passed.
- Run artifact: `.kota/runs/2026-07-24T16-55-23-586Z-builder-tuhsom/validation.txt`.

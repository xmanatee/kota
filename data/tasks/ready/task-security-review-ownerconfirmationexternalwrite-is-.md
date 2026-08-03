---
id: task-security-review-ownerconfirmationexternalwrite-is-
title: Security review: ownerConfirmation.externalWrite is accepted, persisted, inherited, and reported as policy but is never consulted by tool-effect decisions. Setting it to deny does not deny external-network writes or other non-filesystem writes.
status: ready
priority: p2
area: security
task_class: Safety
summary: ownerConfirmation.externalWrite is accepted, persisted, inherited, and reported as policy but is never consulted by tool-effect decisions. Setting it to deny does not deny external-network writes or other non-filesystem writes.
created_at: 2026-08-03T00:34:23.709Z
updated_at: 2026-08-03T00:34:23.709Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/scope-policy-decisions.ts
claim:

> ownerConfirmation.externalWrite is accepted, persisted, inherited, and reported as policy but is never consulted by tool-effect decisions. Setting it to deny does not deny external-network writes or other non-filesystem writes.

## Desired Outcome

> Either remove externalWrite from the policy contract or define its exact effect scopes and enforce it in toolAction. Add decision and end-to-end tool-runner tests proving externalWrite: deny produces denial for every intended external write category.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-02T12-54-03-665Z-security-review-8h4knx.

finding id: owner-confirmation-external-write-unenforced
candidate id: auth-approval-boundary:src/core/daemon/scope-policy-apply.ts:167
verdict: confirmed
rationale:

> externalWrite is decoded, merged, inherited, surfaced, and considered during widening analysis, but no authorization decision reads it. External-network writes use externalEffects.networkWrite, while other writes use ownerConfirmation.localWrite.

Evidence:

Evidence 1:



path: src/core/daemon/scope-policy-types.ts

line: 58

excerpt:



> ScopeOwnerConfirmationPolicy declares localWrite, externalWrite, and destructive as enforceable action policies.

Evidence 2:



path: src/core/daemon/scope-policy-apply.ts

line: 211

excerpt:



> mergeOwner accepts and preserves externalWrite overrides.

Evidence 3:



path: src/core/daemon/scope-policy-decisions.ts

line: 219

excerpt:



> External-network writes consult externalEffects.networkWrite, while every other write consults ownerConfirmation.localWrite.

Evidence 4:



path: src/core/daemon/scope-policy-decisions.ts

line: 225

excerpt:



> No decision branch references ownerConfirmation.externalWrite.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

---
id: task-security-review-approval-ids-are-used-as-filesyste
title: Security review: Approval IDs are used as filesystem path components without validation after route decoding, allowing crafted IDs with encoded slashes or dot segments to read and rewrite sibling .kota JSON records that have pending status.
status: ready
priority: p2
area: security
summary: Approval IDs are used as filesystem path components without validation after route decoding, allowing crafted IDs with encoded slashes or dot segments to read and rewrite sibling .kota JSON records that have pending status.
created_at: 2026-05-26T14:54:53.334Z
updated_at: 2026-05-26T14:54:53.334Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/approval-queue.ts
claim: Approval IDs are used as filesystem path components without validation after route decoding, allowing crafted IDs with encoded slashes or dot segments to read and rewrite sibling .kota JSON records that have pending status.

## Desired Outcome

Validate approval IDs at the queue boundary against the generated ID format or resolve and assert the target path remains inside the approval queue directory. Reject decoded slashes, dot segments, and malformed IDs in CLI and HTTP mutation paths.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T14-44-50-830Z-security-review-24xa9w.

finding id: security-review-approval-id-path-traversal
candidate id: auth-approval-boundary:src/modules/approval-queue/cli.ts:118
verdict: confirmed
rationale: Route parameters are URI-decoded before the approval handler uses params.id, so encoded slashes and dot segments can reach ApprovalQueue. ApprovalQueue joins the supplied id into read and write paths without validating the id format or checking path containment, and only requires the parsed JSON to have pending status.

Evidence:

- src/core/modules/route-matcher.ts:57 - params[segment.slice(1)] = safeDecode(pathParts[i]);
- src/modules/approval-queue/routes.ts:349 - const item = approveApprovalLocal(queue, params.id, note);
- src/core/daemon/approval-queue.ts:84 - const path = join(this.dir, `${id}.json`);
- src/core/daemon/approval-queue.ts:100 - if (!item || item.status !== "pending") return null;
- src/core/daemon/approval-queue.ts:105 - writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(item, null, 2));

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

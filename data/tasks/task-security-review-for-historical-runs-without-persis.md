---
status: open
priority: p3
---
# Security review: For historical runs without persisted delivery metadata, the authenticated run-list API derives blocker text directly from the current task file and returns it without the shared evidence redaction. Credentials or personal information in that blocker section can therefore reach client responses despite the API's evidence-projection policy.


## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/workflow-ops/routes/workflow-run-routes.ts
claim:

> For historical runs without persisted delivery metadata, the authenticated run-list API derives blocker text directly from the current task file and returns it without the shared evidence redaction. Credentials or personal information in that blocker section can therefore reach client responses despite the API's evidence-projection policy.

## Desired Outcome

> Apply the shared daemon-api evidence projection to derived delivery fields before serialization. Verify the historical-run fallback with synthetic sensitive blocker text and confirm that the response redacts it while retaining useful delivery information.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-07T12-39-43-132Z-security-review-ygylet.

Confirmed by security-review workflow runs:

- 2026-09-07T12-39-43-132Z-security-review-ygylet

finding id: workflow-run-delivery-bypasses-evidence-redaction
candidate id: auth-approval-boundary:src/modules/workflow-ops/routes/workflow-run-routes.ts:193
verdict: confirmed
rationale:

> Static inspection confirms the fallback bypasses redaction. Delivery is optional in src/core/workflow/run-metadata.ts:309. When absent, src/modules/workflow-ops/routes/workflow-run-routes.ts:52 derives delivery from workspace files. src/core/workflow/run-delivery.ts:205-212 reads the current blocked task and returns its extracted blocker without projection. The list handler serializes this summary at workflow-run-routes.ts:169 through src/core/server/session-pool.ts:170, which only applies JSON.stringify. Storage redaction cannot protect text read afterward. This violates the daemon-api redaction policy in src/core/evidence/policy-model.ts:246 and policy.ts:241-244. Authentication limits exposure to authorized API clients; no actual sensitive-data disclosure was established.

Evidence:

Evidence 1:



path: src/modules/workflow-ops/routes/workflow-run-routes.ts

line: 52

excerpt:



> delivery: meta.delivery ?? deriveWorkflowRunDelivery(meta, { runsDir }),

Evidence 2:



path: src/core/workflow/run-delivery.ts

line: 13

excerpt:



> const content = readFileSync(path, "utf-8");

Evidence 3:



path: src/core/workflow/run-delivery.ts

line: 212

excerpt:



> blocker: extractBlockerFromTaskContent(blockedParsed.body) ?? "task marked blocked",

Evidence 4:



path: src/modules/workflow-ops/routes/workflow-run-routes.ts

line: 169

excerpt:



> jsonResponse(res, 200, { runs: runs.map((r) => toSummary(r, store.runsDir)), limit, offset });

Evidence 5:



path: src/core/server/session-pool.ts

line: 170

excerpt:



> res.end(JSON.stringify(body));

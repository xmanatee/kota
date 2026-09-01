---
status: open
priority: p1
---
# Security review: Untrusted workflow-run metadata controls a recursive deletion path. A metadata id containing traversal segments can escape .kota/runs and delete the scope root or another writable ancestor during automatic lifecycle sweeps.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/lifecycle-collector.ts
claim:

> Untrusted workflow-run metadata controls a recursive deletion path. A metadata id containing traversal segments can escape .kota/runs and delete the scope root or another writable ancestor during automatic lifecycle sweeps.

## Desired Outcome

> Use the enumerated directory entry as the deletion target, validate metadata ids with validateWorkflowRunId, and require the metadata id to equal the directory name. Resolve the final target and verify it is a direct child of runsDir before recursive deletion; treat mismatches as needs_attention and add traversal-boundary coverage.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-08-28T19-50-19-964Z-security-review-81h53j.

Confirmed by security-review workflow runs:

- 2026-08-28T19-50-19-964Z-security-review-81h53j

finding id: SEC-LIFECYCLE-RUN-ID-PATH-TRAVERSAL
candidate id: auth-approval-boundary:src/core/daemon/lifecycle-collector.ts:767
verdict: confirmed
rationale:

> Persisted metadata is decoded with id as an unrestricted string, the collector substitutes that value for the enumerated directory name, and an automatic non-dry-run sweep recursively deletes join(runsDir, run.id). Traversal segments can therefore resolve outside the runs directory. Protection of tracked run directories does not prevent this when the metadata id differs from its directory name.

Evidence:

Evidence 1:



path: src/core/workflow/run-metadata.ts

line: 128

excerpt:



> id: z.string(),

Evidence 2:



path: src/core/daemon/lifecycle-collector.ts

line: 1064

excerpt:



> const metaPath = join(runsDir, dir, "metadata.json");
> const meta = readWorkflowRunMetadataForEnumeration(metaPath);

Evidence 3:



path: src/core/daemon/lifecycle-collector.ts

line: 1073

excerpt:



> parsedRuns.push({
>   id: meta.id,

Evidence 4:



path: src/core/daemon/lifecycle-collector.ts

line: 1164

excerpt:



> rmSync(join(runsDir, run.id), { recursive: true, force: true });

Evidence 5:



path: src/core/daemon/daemon-context-factory.ts

line: 197

excerpt:



> await collector.sweep({ dryRun: false });

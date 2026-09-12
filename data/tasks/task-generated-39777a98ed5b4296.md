---
status: open
priority: p1
---
# Make runtime evidence reviewable without publishing copied packets to Git

## Problem

Independent critics cannot reliably consume the runtime evidence paths supplied by their review context. Builder xqizqf repaired this by copying an existing packet into the review checkout; the repository's evidence allowlist and ordinary staging then published it. Review access, durable proof retention and repository publication currently depend on incompatible path conventions. Prompt-only guidance would leave the demonstrated access failure unresolved.

Investigation: The reported delivery friction is supported by repository evidence. Commit 836f50411 added 72 evidence files plus the task update. Its REVIEW.md and task record describe copying 71 existing files to make private builder evidence readable by the critic. The inspected checkout contains 1,697 tracked .kota files totaling 12,236,833 bytes, matching the request. These counts describe the consequence, not an independent reason for deletion. All 51 copied input snapshots match their manifest; the response and 5,539,584-byte archive match their recorded SHA-256 values. Original runtime-to-copy equivalence was not independently rechecked.

The maintained builder workflow invokes createCriticCheck through its repair checks. The critic advertises runtimeResources.agentRunDir and run-trace paths, while invokeAgentJudge supplies a deny-all judge contract without an explicit evidence-access handoff. Existing diagnostic exports already select scoped evidence, read through anchored filesystem operations, redact projections and report unavailable references. They are bounded diagnostic readers, not a complete packet or binary export service. Separately, .gitignore admits runs/*/evidence and RunLifecycle.stageChanges stages ordinary nonignored changes. Together these mechanisms explain why copying evidence into the checkout solved review access and published redundant runtime material.

One scoped task should connect review access and durable retention through the existing run-artifact and export owners, then retire repository copying as the transport. Maintained source, reusable recipes and representative fixtures belong with their code owners; terminal task records retain concise outcomes and provenance. Execution logs, compiled payloads and frozen copies of source inputs belong in retained runtime evidence unless independently justified as maintained repository assets.

The active-task inventory at main revision fe46811ea549e828e4e7b56e8248cb8112c8eb71 contains no shared evidence-delivery implementation contract. The AGY benchmark remains its consumer and keeps its measurement outcome; the test-reduction audit owns a different outcome. This request does not reopen the previous work-supply or security judgments. No supplied clone observation or durable autonomy issue was established as the cause, so deliveryIssueKeys is empty. Canonical run metadata was denied, the attempted original critic-verdict path was absent, and parent mono guidance was inaccessible. No live sandbox reproduction, benchmark execution or measured improvement is claimed.

Evidence:
- git:836f50411
- git:450ca04e6927390e99b1519bc4affed9ea09bedd:.kota
- git:fe46811ea549e828e4e7b56e8248cb8112c8eb71:data/tasks
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- .gitignore
- .kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/REVIEW.md
- .kota/runs/2026-09-12T14-17-30-067Z-builder-xqizqf/evidence/agy-model-routing
- data/tasks/task-execute-agy-model-benchmark-and-document-routing-d.md
- data/tasks/task-reassess-published-fifty-percent-test-reduction.md
- src/modules/autonomy/workflows/builder/repair-checks.ts
- src/modules/autonomy/critic.ts
- src/modules/autonomy/agent-judge.ts
- src/modules/autonomy/product-evidence.ts
- src/modules/autonomy/issue-evidence.ts
- src/modules/autonomy/issue-evidence-files.ts
- src/modules/autonomy/issue-evidence.test.ts
- src/modules/autonomy/critic-product-evidence.test.ts
- src/core/workflow/steps/step-context.ts
- src/core/workflow/run-lifecycle.ts
- src/core/workflow/run-lifecycle.test.ts
- src/core/workflow/run-sandbox.ts
- src/modules/workflow-ops/routes/workflow-run-routes.ts

## Desired Outcome

A builder can produce proof under the existing runtime artifact roots and an independent read-only critic can inspect the authorized evidence before publication. References remain attributable and resolvable after successful cleanup or retained-run recovery. Normal publication includes intended source and task changes without requiring runtime packets, copied source trees or compiled payloads in Git. Expected reductions in duplication and repair effort remain unverified until implementation.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Builder repair review through builderRepairChecks and createCriticCheck, including the retained AGY benchmark preparation packet.
- Shared nested judge execution and workflow step context, which must deliver evidence without granting mutation or host-control authority.
- Existing scoped diagnostic export consumers, including builder issue preflight and improver; their domain selection and unavailable-evidence semantics remain intact.
- RunLifecycle and RunSandboxManager publication, retention, cleanup and recovery, together with workflow run-artifact inspection.

Alternatives considered:
- Leave the implementation unchanged: preserves existing behavior but retains the demonstrated copy-to-review workaround and repository duplication.
- Change only prompts or ignore rules: can discourage publication but cannot make inaccessible evidence readable or preserve it through runtime cleanup.
- Delete copied evidence immediately: unjustified while those copies remain usable historical proof and replacement references have not been verified.
- Consolidate the common evidence handoff at the existing workflow run-artifact owner, reusing scoped export, anchored read and evidence-policy mechanisms. This is the preferred direction.
- Add a second artifact store, broad host read grant or per-builder copy bridge: duplicates ownership or weakens isolation without resolving the shared contract.

Migration and retirement: Implement one runtime-owned evidence handoff for the current run and explicitly authorized linked evidence. Reuse the existing scoped exporters and run-artifact storage, extracting only common selection-to-reference delivery that maintained consumers actually share; retain domain authorization and redaction differences. Supply critic-readable references through the shared judge/step boundary with explicit provenance, integrity, projection and unavailable states. Preserve original binary and source-snapshot proof in the existing runtime evidence owner; a bounded or redacted projection must identify its limits and must not masquerade as the original. Make the required retained evidence durable before sandbox cleanup and preserve retry/restart attribution.

Migrate critic path discovery, including the builder-evidence compatibility mapping if importer verification confirms replacement, to the shared handoff. Align repository publication policy and guidance so new runtime packets are not admitted merely for reviewer access; retain intentional maintained fixture exceptions. Inventory existing tracked evidence before retiring any copy. Start with the xqizqf packet, preserving its original run, source revision, hashes, tool-use attribution and zero-benchmark-run disposition. Verify replacement references and bytes before a scoped repository removal; keep originals or unresolved copies when retention cannot be proved. Keep reusable authored recipes with an existing maintained owner where appropriate. Do not rewrite Git history, blanket-delete .kota, alter dirty worktrees, or revise retained benchmark task contracts outside their runtime owner.

Common behavior: Deliver selected, attributable run evidence to an authorized read-only consumer, preserving integrity, projection limits and explicit unavailability independently of repository publication.
Stable variation point: Consumers own evidence selection and interpretation; content policy distinguishes diagnostic projections, exact retained assets and unavailable material. Domain identifiers, binary proof and ordinary text cannot all be treated as interchangeable redacted JSON.
Canonical owner: The existing core workflow run-artifact lifecycle, composed with core evidence policy and anchored filesystem I/O. Autonomy retains critic judgment and domain-specific export selection; workflow-ops remains an inspection consumer.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise the real builder-to-critic composition with a controlled harness that actually reads the supplied evidence under the production sandbox policy, rather than returning a canned verdict after inspecting prompt strings. Demonstrate review of an unpublished transcript, structured response and selected packet input while direct private-runtime and cross-scope access remain denied and the critic cannot mutate evidence. Retain focused owner checks for scope selection, traversal/symlink/hard-link rejection, secret and reasoning redaction, altered or unavailable references, and projection limits. Distinguish original content hashes from projected-content hashes. Cover successful publication and cleanup, retained failure, restart and export failure without losing proof or falsely completing the run. Use a representative packet plus the inspected xqizqf hashes to verify migration. Build and check affected contracts and run proportionate owner, security and lifecycle integration checks; report unavailable native-platform checks honestly.

Show an attributable builder review and publication where evidence remains readable before and after cleanup while the Git changeset contains only intended repository content. Trace maintained callers through the shared handoff and show the replaced critic path convention and manual packet-copy requirement are retired. Compare the resulting ownership and consumer paths, rather than claiming benefit from file counts alone. Report exactly which historical copies were retired, their verified replacement references and which were intentionally preserved. Replace redundant prompt-only evidence-access assertions with the owning behavioral proof while retaining distinct export-security and lifecycle checks. Do not merge unrelated code/test reduction work into this task.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

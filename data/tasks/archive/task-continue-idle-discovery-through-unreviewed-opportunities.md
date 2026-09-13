---
status: done
---

# Keep idle discovery open to useful unreviewed opportunities

## Problem

At the September 13 recovery, Gardener inspected 74 observations but skipped its
agent because the repo-scoped judgment for runtime-evidence retention remained
settled. Run `2026-09-12T23-10-28-909Z-architecture-gardener-r9ql31` records the
decision. All delivery tasks were held or externally blocked. One mechanism's
settlement must not imply that every other useful opportunity was investigated.

Explorer also gates a changed task/source fingerprint on an accessible response
from the current fetch batch. Previously retained readable sources cannot support
reconsideration when the queue changes before their next network recheck.
Verify these behaviors in admission.ts, gardener state/publication, and Explorer's
source-evidence.ts against actual consumers before choosing the smallest correction.

## Outcome

When no independent builder work is available, Gardener can investigate a relevant
unreviewed mechanism, or Explorer can identify useful ideas from authorized source
material. Retained runs and unrelated external blockers do not veto this work.
Reuse the existing workflow, scope, proposal identity and admission owners.

Scope a settled judgment to what was actually assessed. Preserve deduplication
of settled findings and active tasks, but do not consume unrelated opportunities
as a side effect. Reuse readable retained source material when appropriate;
an unavailable optional URL is not a blanket ban on independent research.
Agents should choose worthwhile work, not satisfy a task-count quota.

If all currently known opportunities are genuinely exhausted, make that specific
reason visible and allow new owner direction, new sources, changed task supply or
new structural findings to reopen discovery. Do not manufacture repeated no-op
agent runs just to make both capacity slots look busy.

## Acceptance

An idle queue with one settled mechanism and another grounded unreviewed
opportunity can produce a non-duplicate actionable task. Replaying the same
settled opportunity without a material change does not. A useful changed task
context can reuse available source material without requiring every source to
refresh. Existing healthy builders keep priority and unique ownership.

Use focused admission/publication scenarios and one actual idle-to-task-to-builder
observation when available. Missing optional live observation must not prevent
integration of an otherwise verified implementation. Remove replaced gating and
stale instructions rather than layering another scheduling mechanism.

## Outcome evidence

Gardener now retains explicit observation coverage across judgments in the same
scope. A settlement consumes cited fingerprints, leaving other structural leads
eligible during idle capacity. The existing proposal materializer, task ownership,
and delivery-priority gate remain the production owners. Each retained assessment
keeps its own delivery baseline, issue keys and revisit reason. A later review of
another mechanism cannot erase those conditions or consume their changed evidence;
reassessing the associated observations replaces their conditions. Disappeared or
replaced structural fingerprints remain pending until explicitly reassessed;
an unrelated settlement cannot consume their removal or changed delivery evidence.
Citing a retained fingerprint after inspecting its resolution settles that pending
assessment. A later reappearance is unreviewed evidence.
Explorer retains readable-source provenance and restores verified bytes into the
agent workspace when task context changes, including before network refresh and
after optional fetch failures. Missing or mismatched retained bytes do not admit
source-based claims. Prompts distinguish retained observations from fresh access.

Focused admission/source scenarios passed (10 tests), covering exhausted/replayed
opportunities, legacy coverage, changed task intent, retained bytes after cleanup,
failed refreshes, and invalid or missing evidence. The workflow publication and
priority scenarios passed (4 tests), producing one independent actionable task
without modifying retained work and yielding to available delivery work. The
publication scenario uses the real task validator through a controlled subprocess
port; production runtime still owns publication and revisioned state. The durable
issue scenario settles two independent observations, removes the first signal and
changes its delivery issue, then reviews only the second. It verifies that the
first assessment remains pending across a state reconnection, explicit inspection
of its removal settles it, and the next replay skips investigation.
Focused policy proof additionally covers issue removal, partial reassessment,
rejected correlations, source-only legacy judgments, unrelated churn, removal
without delivery changes, replacement fingerprints and later reappearance. These
checks cover the critic's reported loss of earlier revisit conditions.

A replay of the captured September 12 Gardener incident changes admission from
false to true and exposes 34 unassessed structural leads among 74 observations.
That is admission evidence, not a claim that all leads merit tasks. The captured
input and replay are retained in this builder run. No live deployed
idle-to-task-to-builder observation or model-quality evaluation was performed.
The broader owner run encountered sandbox process-inspection denial and transient
temporary-directory loss; focused proof uses a stable temporary directory.

The complete changeset passed `pnpm check:fast` and production TypeScript emission
with `pnpm exec tsc -p tsconfig.build.json --outDir <run-directory>/compiled`.
`pnpm build` did not complete: the sandbox denied removal of existing `dist`
directories before compilation. Runtime asset packaging is therefore not claimed
as verified by that command. Final validation results and logs are in this run.

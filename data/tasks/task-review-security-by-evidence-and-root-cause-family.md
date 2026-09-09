---
status: open
priority: p1
---
# Review security by evidence and root-cause family

## Problem

The owner observes repeated security-task production around related authority
boundaries. Do not assume those findings are false or equivalent. At 763e14b14,
recent fixes and open findings include credential access, database confinement,
post-run Git execution and browser persistence. They need explicit coverage and
root-cause ownership, not either blanket suppression or one isolated patch per sink.

Inspect security-review admission, due-check, candidate generation, critic,
task publication and deduplication together with actual recent transcripts and
fix diffs. Separate counts of cheap code runs from agent occupancy and distinguish
confirmed exploit preconditions from speculative claims. Record the pinned cohort,
root families, task outcomes, repeat findings and useful review yield.

The September 3-9 artifact-backed cohort has 28 reviews: 25 successes and three
provider/CLI failures; 14 confirmed findings, zero task updates, and 12 no-finding
reviews. Investigation/revalidation steps total 87.1 elapsed minutes, not model
compute or a concurrency-adjusted capacity share. Six findings are native-authority
variants. Writer database protection landed in c604ec75c, then non-writer exposure
was found: native-run-authorization.ts returns before constructing denials when
writer identity is absent. Four associated fixes needed substantive critic repair.
Exact repeated finding identity was NOT demonstrated; all 14 identities differ.
security-review-tasks.ts publishes each finding separately; task-identity matching
requires finding ID plus candidate ID, whose file/line component is unstable.

## Desired Outcome

Make meaningful unreviewed security changes and findings, not elapsed time or a
mandatory after-build ritual, admit semantic review. Coalesce related changed
surfaces into a bounded review with honest coverage. Review all justified findings
in that scope; there is no quota requiring exactly one issue or task per run.
Group findings only when a common authority owner and repair really resolve them;
retain distinct exploit preconditions and regressions even inside one repair task.
Update an existing active family task instead of generating sibling sink tasks.
Reopen a resolved issue only for new evidence; a broader family must not suppress
a distinct serious finding. Critical new evidence may bypass batching delay.
Match production owner plus violated invariant, retaining variants and evidence;
do not mutate an active builder's admitted contract underneath it. Use existing
resource-aware task publication/reconciliation and preserve completed evidence.

Use deterministic security signals where they fit, after checking existing owners:
dependency advisories, unsafe call sites and known policy bypass patterns can be
screened by an established local analyzer. Scope-aware static/taint analysis can
inform the agent; it cannot prove all authorization, race or sandbox properties.
Sandboxing contains execution, it does not automatically discover vulnerabilities.
Compare a small local scanner experiment against known repaired and clean cases;
adopt only useful rules, otherwise retain a documented no-adoption decision.

## Constraints

Reuse current security review, typed findings, task materialization and durable
admission state. No second vulnerability database, custom general scanner or new
security bot. No uploading source, secrets or transcripts to external scanners.
Keep unreviewed evidence when a run fails; a no-finding result must state coverage,
not silently mark unchecked files reviewed. Do not suppress by filename alone,
equate scanner silence with safety, or remove tests that catch distinct exploits.

## How We Will Know

A pinned recent review/fix cohort shows real family coverage and unnecessary
repeats separately. One common-root multi-sink example produces a coherent task,
unchanged evidence produces no duplicate, and a distinct new exploit still admits.
Public trigger/publication evidence proves changed-head freshness and retry after
failed review. Compare agent time and actionable outcomes before/after without
tuning solely to make a count look better.

## Research Basis

https://semgrep.dev/docs/category/local-and-cli-scans and
https://semgrep.dev/docs/semgrep-ci/sample-ci-configs describe established local
and baseline-aware scanning. Findings are inputs to investigation, not proof that
all related code is safe or that an ignored finding was fixed.
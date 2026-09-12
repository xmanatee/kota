---
status: done
---

# Consolidate tool-execution verification at execution and policy boundaries

## Scope

Own `src/core/tools` (12,231 test LOC) and `src/modules/execution` (5,039), with
their directly used test support. Identify generic runner/policy behavior versus
tool-specific semantics; native harness adaptation belongs to its separate task.

## Required Outcome

Remove repeated setup and policy permutations in tool consumers when an existing
runner or execution boundary already proves them. Preserve distinct validation,
denial, cancellation, subprocess termination, path confinement and effect handling.
Use shared typed parameter/permission consumers rather than literal tool catalogs.

Mocks of process creation are useful for argument/error projection but do not
replace real process-group or filesystem safety checks. Keep those proofs at
their owner, not once per tool. Do not rewrite execution protocols or grant broader
host access to make a test pass. Security primitives are not redundant merely
because TypeScript interfaces share a shape.

## Acceptance

Use `task-verify-fifty-percent-test-reduction` rules. Publish local ownership
simplifications and remove obsolete support with its last consumer. Run relevant
behavioral and real-boundary checks once; report test/support and any implicated
production deltas.

## Completion

Consolidated environment propagation into typed consumers of the real shell,
background-process, Python and Node launch paths. The no-context policy is checked
once at `buildExecutionEnv`; per-call REPL identity refresh and credential teardown
remain separate behavior. Combined Node timeout/recovery into one journey and
removed the repeated Python recovery sequence, retaining interruption and state
preservation. Removed shell checks already established by exact output/cwd checks,
including the quick command that did not prove its claimed default timeout.

Permission tests now use real registrations and typed runners, with explicit
filesystem target declarations and a shared scope-policy fixture. Removed their
mock support file. Runner scheduling fixtures declare scenario tools instead of
maintaining a name catalog; the retained deferred execution test proves actual
concurrency and model result order in place of the redundant call-count case.
Validation, denial, symlink confinement, approvals, cancellation, sandboxing,
subprocess lifecycle and effect-specific proofs remain with their owners.

Local candidate census against `8e5cb18a046ab3f55c35605b55eb97ddd1689b60`, using the
unchanged frozen recipe: core/tools test LOC 11,281 → 11,212, support 467 → 386;
execution test LOC 5,159 → 5,002, support 45 → 17. Total reduction: 226 executable
test LOC and 109 support LOC. Production and generated/vendor deltas are zero.
These are unpublished local numbers; the successor audit owns aggregate acceptance.

Validation: 442 tests passed across all execution and tool-runner owner suites;
10 tests passed in tool-target-authorization and conversation-file-access
integration suites. These exercise live child environments, interruption/recovery,
policy denial, real filesystem effects, approval binding and protected paths.
`pnpm check:fast` passed. Full release and live-model portfolios were not run for
this test/support-only change; final aggregate verification belongs to the audit.
No runtime protocol or host permission was changed. Distinct GUI, classification,
manifest, subprocess and native-harness protections were not deleted for a quota.

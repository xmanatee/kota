---
status: done
---
# Security review: Runtime directory creation and rollback use path-based checks followed by separate filesystem mutations. An untrusted scope can replace an ancestor with a symlink between those operations, causing the daemon to create or remove directories outside the accepted scope root.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/scope-onboarding.ts
claim:

> Runtime directory creation and rollback use path-based checks followed by separate filesystem mutations. An untrusted scope can replace an ancestor with a symlink between those operations, causing the daemon to create or remove directories outside the accepted scope root.

## Desired Outcome

> Perform runtime-directory creation and rollback through an anchored, no-follow filesystem operation that verifies every path component relative to the accepted scope root at mutation time. Preserve and verify root identity across the transaction, and add a defensive test covering ancestor replacement.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-03T09-06-14-140Z-security-review-jv1343.

Confirmed by security-review workflow runs:

- 2026-09-03T09-06-14-140Z-security-review-jv1343

finding id: scope-onboarding-unanchored-runtime-path-mutation
candidate id: tool-execution:src/core/daemon/scope-onboarding.ts:1
verdict: confirmed
rationale:

> The service constructs absolute target paths, checks them with lstatSync, then separately calls mkdirSync or rmdirSync. lstatSync rejects a symlink only at the final component; replaced intermediate components are followed. An isolated filesystem probe confirmed that replacing .kota with a symlink after the check causes creation and rollback to mutate directories outside the scope root. Apply-time root canonicalization does not protect later mutations.

Evidence:

Evidence 1:



path: src/core/daemon/scope-onboarding.ts

line: 1029

excerpt:



> const target = join(operation.acceptedPlan.directoryRoot, change.path);

Evidence 2:



path: src/core/daemon/scope-onboarding.ts

line: 1031

excerpt:



> const pathState = runtimeDirectoryState(target);

Evidence 3:



path: src/core/daemon/scope-onboarding.ts

line: 1054

excerpt:



> (this.options.createRuntimeDirectory ?? mkdirSync)(target);

Evidence 4:



path: src/core/daemon/scope-onboarding.ts

line: 1090

excerpt:



> rmdirSync(target);

Evidence 5:



path: src/core/daemon/scope-onboarding.ts

line: 1778

excerpt:



> const stats = lstatSync(path);

## Resolution

Runtime-directory plans now retain the accepted scope-root device/inode identity. Apply installs each missing leaf with Darwin's atomic no-follow, beneath-root rename primitive using the accepted root descriptor and complete relative path. Ancestor screening and installation therefore occur in one kernel operation instead of separate cwd-relative checks and mutations. Randomized staging leaves are direct children of the accepted root, and their creation, inspection, and no-follow cleanup stay relative to that descriptor. Hosts without the atomic creation primitive fail closed.

Rollback deliberately performs no runtime-directory filesystem mutation. Darwin does not provide a compare-and-delete operation that can require a name to still identify the recorded inode at the instant it is renamed or removed; an inspect-then-quarantine sequence retains the original TOCTOU gap. Compensation instead releases transaction ownership and retains the created directories, which are safe state for a fresh plan to recognize. Replaced paths and user content therefore cannot be moved into a quarantine name by cancellation.

## Final verification

- A focused owner test replaces a created runtime-directory leaf with a sentinel-bearing directory immediately before a failed apply is compensated. It proves cancellation never calls the filesystem mutator, the sentinel remains at its original path, and no quarantine entry appears.
- The ancestor-replacement and staging-replacement probes continue to exercise the production creation helper at the atomic syscall boundary.
- A direct helper probe creates top-level and nested runtime directories, rejects the removed deletion operation, and preserves the nested sentinel.
- Ruby syntax validation and Node TypeScript syntax checks pass for every touched source and test file. The focused Vitest suite and `check:fast` could not run in this repair sandbox because the workspace package shims resolve to dependencies outside its executable boundary.

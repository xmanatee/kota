---
status: open
priority: p2
---
# Security review: Browser profile persistence checks filesystem authority separately from the write. When persistProfile is enabled, a concurrent writer able to replace the profile file or an ancestor directory can redirect the path after validation but before Playwright writes it. This can write authenticated browser state outside the agent's declared write roots with the host process's permissions. The canonical-path recheck does not make the subsequent pathname-based write atomic.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/browser/lifecycle.ts
claim:

> Browser profile persistence checks filesystem authority separately from the write. When persistProfile is enabled, a concurrent writer able to replace the profile file or an ancestor directory can redirect the path after validation but before Playwright writes it. This can write authenticated browser state outside the agent's declared write roots with the host process's permissions. The canonical-path recheck does not make the subsequent pathname-based write atomic.

## Desired Outcome

> Obtain storage state without supplying Playwright a filesystem path, then persist it through a runtime-owned write primitive that atomically enforces the authorized root and prevents symlink traversal, including ancestor replacement. Verify rejection of target changes between authorization and the actual write. This finding rests on static inspection; no exploitation was attempted.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-08T06-21-00-621Z-security-review-ikupt2.

Confirmed by security-review workflow runs:

- 2026-09-08T06-21-00-621Z-security-review-ikupt2

finding id: browser-profile-persistence-path-race
candidate id: secret-handling:src/modules/browser/AGENTS.md:43
verdict: confirmed
rationale:

> Static inspection confirms separate authorization and pathname-based persistence. src/modules/browser/browser-profile.ts:129-146 re-resolves the target, compares its pathname with the captured pathname, and checks allowed write roots, then returns a string. src/modules/browser/lifecycle.ts:221-235 subsequently passes that string to Playwright storageState without binding the write to a validated filesystem handle. With persistence enabled and a concurrent writer able to replace the target or an ancestor, the later write can resolve outside the authorized roots, subject to host filesystem permissions. The test at src/modules/browser/lifecycle-profile.test.ts:288 covers redirection before the close-time check, not replacement between validation and writing. Persistence needs a runtime-owned primitive that enforces containment during the actual write, including ancestor traversal.

Evidence:

Evidence 1:



path: src/modules/browser/browser-profile.ts

line: 129

excerpt:



> const currentPath = resolveBrowserProfileStoragePath(snapshot, identity);
>   if (currentPath !== capturedPath) {

Evidence 2:



path: src/modules/browser/browser-profile.ts

line: 137

excerpt:



> allowedWriteRoots !== undefined &&
>     !allowedWriteRoots.some((root) =>
>       isScopePolicyPathWithin(canonicalWriteRoot(root), currentPath)
>     )

Evidence 3:



path: src/modules/browser/lifecycle.ts

line: 221

excerpt:



> const resolved = resolveBrowserProfilePersistencePath(
>     resource,
>     resource.identity,
>     resource.storagePath,
>     resource.allowedWriteRoots,
>   );

Evidence 4:



path: src/modules/browser/lifecycle.ts

line: 235

excerpt:



> await resource.context.storageState({ path: resolved });

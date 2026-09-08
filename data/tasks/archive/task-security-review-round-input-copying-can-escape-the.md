---
status: done
---
# Security review: Round-input copying can escape the fixture workspace through a symlink in a destination ancestor. The host reuses the previous round's writable workspace, checks only lexical path containment, then creates directories and copies files before entering the executor. A symlink left in that workspace can therefore redirect the host write outside the container-mounted tree, creating or overwriting a host file with fixture-input contents.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/runner-materialize.ts
claim:

> Round-input copying can escape the fixture workspace through a symlink in a destination ancestor. The host reuses the previous round's writable workspace, checks only lexical path containment, then creates directories and copies files before entering the executor. A symlink left in that workspace can therefore redirect the host write outside the container-mounted tree, creating or overwriting a host file with fixture-input contents.

## Desired Outcome

> Perform round-input writes within the fixture isolation boundary, or enforce filesystem containment with symlink-safe ancestor traversal and race-resistant writes. Verify that a destination ancestor pointing outside the workspace is rejected without changing the external location.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-08T03-29-04-521Z-security-review-nwvl6n.

Confirmed by security-review workflow runs:

- 2026-09-08T03-29-04-521Z-security-review-nwvl6n

finding id: eval-round-input-symlink-escape
candidate id: tool-execution:src/modules/eval-harness/runner-materialize.ts:2
verdict: confirmed
rationale:

> Static inspection confirms the boundary violation. runner-materialize.ts:99-114 checks lexical containment only; lines 133-144 then create destination directories and copy through filesystem ancestors without rejecting symlinks. subprocess-executor-command.ts:96-105 mounts the workspace writable. runner-multi-fixture.ts:118-153 reuses that workspace after a passing round, and runner-rounds.ts:32-36 applies the next input on the host before executor invocation at line 72. Consequently, a destination-ancestor symlink retained from a passing round can redirect the copy outside the workspace, subject to host filesystem permissions. Contents and destination suffix remain constrained by the fixture input. Move input writes inside isolation or enforce symlink-safe, race-resistant filesystem containment.

Evidence:

Evidence 1:



path: src/modules/eval-harness/runner-materialize.ts

line: 103

excerpt:



> const absoluteRoot = resolve(root);
>   const resolved = resolve(absoluteRoot, relativePath);
>   const rootWithSep = absoluteRoot.endsWith(sep)
>     ? absoluteRoot
>     : `${absoluteRoot}${sep}`;
>   if (resolved !== absoluteRoot && !resolved.startsWith(rootWithSep)) {

Evidence 2:



path: src/modules/eval-harness/runner-materialize.ts

line: 143

excerpt:



> mkdirSync(dirname(target), { recursive: true });
>       cpSync(source, target);

Evidence 3:



path: src/modules/eval-harness/runner-rounds.ts

line: 32

excerpt:



> const triggerPayload = applyRoundTaskInput(
>     params.round.taskInput,
>     params.fixture.fixtureDir,
>     params.workingDir,
>   );

Evidence 4:



path: src/modules/eval-harness/runner-multi-fixture.ts

line: 118

excerpt:



> for (let roundIndex = 0; roundIndex < spec.rounds.length; roundIndex++) {
>     const round = spec.rounds[roundIndex];
>     const roundResult = await executeRound({
>       round,
>       roundIndex,
>       fixture: params.fixture,
>       executor: params.executor,
>       executionProfile: params.executionProfile,
>       ...(params.agentExecutionOverride !== undefined && {
>         agentExecutionOverride: params.agentExecutionOverride,
>       }),
>       workingDir,

## Resolution

Round-input copying now uses a dedicated Node helper with an empty environment.
It opens destination directories with `O_DIRECTORY | O_NOFOLLOW`, pins each as
its process working directory, and verifies the entered inode against the open
descriptor before any relative write. Descendant path replacements cannot
redirect writes through an ancestor symlink. Exclusive temporary-file creation,
descriptor-based writes, and atomic leaf replacement also avoid truncating a
symlink or hard-linked external file. Unsupported traversal fails closed.

The containment argument relies on the existing host-owned workspace parent and
the candidate's workspace-only writable mount; an attacker with independent host
access that can move pinned directories outside that mount is outside this boundary.

Verification: 12 focused owner tests passed across `runner-materialize.test.ts`
and `runner-multi-round.test.ts`. The public `runFixture` regression retains an
external ancestor symlink after a passing first round, then observes rejection
before the second executor call and unchanged external contents. Materialization
checks cover missing and existing external targets, nested directory creation,
root and leaf symlinks, hard links, and normal binary input replacement. The six
existing `runner.test.ts` checks also passed. Production and test typechecks and
Biome checks on all changed TypeScript files passed.

These deterministic owner checks and inspection of the pinned-directory and
atomic-replacement operations prove the host filesystem boundary directly. No
live model/container evaluation or adversarial race stress run was performed.

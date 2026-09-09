---
status: open
priority: p1
---
# Security review: A scope-controlled node_modules symlink can expand a subsequent native agent's filesystem read authority outside the approved workspace. dependencyReadRoots accepts its resolved target without checking that it is an authorized dependency location. Sandbox construction grants recursive read access to that target, potentially exposing unrelated host files and credentials not covered by explicit denials.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/native-cli-sandbox-roots.ts
claim:

> A scope-controlled node_modules symlink can expand a subsequent native agent's filesystem read authority outside the approved workspace. dependencyReadRoots accepts its resolved target without checking that it is an authorized dependency location. Sandbox construction grants recursive read access to that target, potentially exposing unrelated host files and credentials not covered by explicit denials.

## Desired Outcome

> Validate canonical dependency targets against runtime-owned authorized locations before granting read access. Reject scope-controlled symlinks that resolve outside those locations while retaining explicitly authorized package-store links. Verify that an unauthorized resolved target never enters either platform's sandbox grants.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T01-49-08-004Z-security-review-xwpqj6.

Confirmed by security-review workflow runs:

- 2026-09-09T01-49-08-004Z-security-review-xwpqj6

finding id: dependency-symlink-expands-sandbox-read-access
candidate id: tool-execution:src/core/agent-harness/native-cli-sandbox-roots.ts:1
verdict: confirmed
rationale:

> native-cli-sandbox-roots.ts:107-117 resolves existing workspace and ancestor node_modules paths without authorizing their canonical targets; line 161 adds those targets to readable roots. native-cli-sandbox.ts:217-236,279 passes them into sandbox construction. machine-authority-sandbox.ts:58-60 canonicalizes without restricting targets, then grants Linux read-only mounts at lines 151-155. macOS grants recursive reads through machine-authority-sandbox-paths.ts:22-26,79. Explicit read denials still apply, but unrelated host files outside those denials become readable when a scope-controlled dependency symlink targets their directory. Require runtime-authorized canonical dependency locations before granting access. The previous revision already accepted the nearest dependency target; this change extends discovery to all ancestors.

Evidence:

Evidence 1:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 113

excerpt:



> if (existsSync(dependencyRoot)) roots.push(realpathSync.native(dependencyRoot));

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 161

excerpt:



> ...dependencyReadRoots(cwd),

Evidence 3:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 279

excerpt:



> readableRoots,

Evidence 4:



path: src/core/agent-harness/machine-authority-sandbox-paths.ts

line: 79

excerpt:



> `(allow file-read* (literal "/") ${sandboxPathSelectors(options.readableRoots).join(" ")})`,

Evidence 5:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 151

excerpt:



> const readableMounts = readableRoots?.flatMap((path) => [
>       "--ro-bind",
>       path,
>       path,
>     ]) ?? [];

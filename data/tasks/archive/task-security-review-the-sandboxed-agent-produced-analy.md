---
status: done
---

# Security review: The sandboxed, agent-produced analyzer can still signal and terminate its parent or other same-UID host processes. The macOS profile denies only network operations, the Linux configuration creates no PID namespace, and Node's permission model does not restrict process.kill(). A malicious analyzer can therefore terminate the synchronous evaluator and potentially the daemon hosting an eval cadence.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/scientific-claim-network-sandbox.ts
claim:

> The sandboxed, agent-produced analyzer can still signal and terminate its parent or other same-UID host processes. The macOS profile denies only network operations, the Linux configuration creates no PID namespace, and Node's permission model does not restrict process.kill(). A malicious analyzer can therefore terminate the synchronous evaluator and potentially the daemon hosting an eval cadence.

## Desired Outcome

> Execute candidate analyzers behind a verified process-isolation boundary that prevents signaling host processes. Use a PID namespace or disposable container on Linux and an explicit, capability-tested signal restriction on macOS. Add a regression that runs an analyzer attempting process.kill() against a sentinel and proves both the sentinel and evaluator survive.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T15-52-06-648Z-security-review-6h8yw5.

finding id: security-review-scientific-claim-analyzer-host-signal
candidate id: tool-execution:src/modules/eval-harness/scientific-claim-network-sandbox.ts:1
verdict: confirmed
rationale:

> The macOS profile permits everything except network operations (src/modules/eval-harness/scientific-claim-network-sandbox.ts:6), while the Linux boundary creates user and network namespaces without a PID namespace (src/modules/eval-harness/scientific-claim-network-sandbox.ts:115). The untrusted analyzer is executed directly through this boundary (src/modules/eval-harness/scientific-claim-network-sandbox.ts:171), and its Node permission flags restrict filesystem access but not process signaling (src/modules/eval-harness/scientific-claim-predicate.ts:149). A local Node v22.19.0 probe under --permission successfully called process.kill(targetPid, 0). Because predicate evaluation runs in the cadence workflow process after fixture execution (src/modules/eval-harness/runner-single-fixture.ts:185), an analyzer can signal that evaluator or another visible same-UID process.

Evidence:

Evidence 1:

path: src/modules/eval-harness/scientific-claim-network-sandbox.ts

line: 6

excerpt:

> const DARWIN_NETWORK_DENY_PROFILE = "(version 1) (allow default) (deny network*)";

Evidence 2:

path: src/modules/eval-harness/scientific-claim-network-sandbox.ts

line: 115

excerpt:

> The Linux unshare arguments create user and network namespaces but no PID namespace.

Evidence 3:

path: src/modules/eval-harness/scientific-claim-network-sandbox.ts

line: 171

excerpt:

> spawnSync launches the agent-produced analyzer directly inside the network-only OS boundary.

Evidence 4:

path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 149

excerpt:

> The Node permission invocation grants filesystem capabilities but establishes no process-signaling restriction.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `.kota/runs/2026-07-25T16-18-47-136Z-builder-c4a4v7/security-regression.txt`
  records the sentinel attack regression and fail-closed host capability result.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/eval-harness/scientific-claim-analyzer-sandbox.test.ts src/modules/eval-harness/scientific-claim-reproduction-fixture.test.ts src/modules/eval-harness/accepted-alternative-fixtures.test.ts`
- `node_modules/.bin/tsc --noEmit`

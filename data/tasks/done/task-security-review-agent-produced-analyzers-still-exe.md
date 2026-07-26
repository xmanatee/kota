---
id: task-security-review-agent-produced-analyzers-still-exe
title: Security review: Agent-produced analyzers still execute on the host without a hard memory, CPU, file-descriptor, or process resource quota. The wrapper supplies only a wall-clock timeout and output-buffer limit; neither prevents rapid memory exhaustion. Predicate evaluation occurs after the isolated fixture executor and runs from the cadence process, so a malicious analyzer can block the daemon and potentially exhaust host memory.
status: done
priority: p1
area: security
task_class: Safety
summary: Agent-produced analyzers still execute on the host without a hard memory, CPU, file-descriptor, or process resource quota. The wrapper supplies only a wall-clock timeout and output-buffer limit; neither prevents rapid memory exhaustion. Predicate evaluation occurs after the isolated fixture executor and runs from the cadence process, so a malicious analyzer can block the daemon and potentially exhaust host memory.
created_at: 2026-07-25T17:58:21.133Z
updated_at: 2026-07-26T01:19:08.621Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts
claim:

> Agent-produced analyzers still execute on the host without a hard memory, CPU, file-descriptor, or process resource quota. The wrapper supplies only a wall-clock timeout and output-buffer limit; neither prevents rapid memory exhaustion. Predicate evaluation occurs after the isolated fixture executor and runs from the cadence process, so a malicious analyzer can block the daemon and potentially exhaust host memory.

## Desired Outcome

> Execute analyzer verification inside a disposable OS-enforced resource boundary with hard memory, CPU, PID, and file-descriptor limits. Keep the timeout as a secondary control and add a bounded regression proving an allocation-heavy analyzer is terminated without blocking or destabilizing the evaluator.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T17-28-29-425Z-security-review-i6cvr8.

finding id: security-review-scientific-claim-analyzer-resource-exhaustion
candidate id: tool-execution:src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts:1
verdict: confirmed
rationale:

> spawnScientificClaimAnalyzer at scientific-claim-analyzer-sandbox.ts:129-138 applies a timeout, output buffering, and kill signal without an OS-enforced memory, CPU, PID, or descriptor quota. scientific-claim-predicate.ts:149-164 likewise supplies only filesystem permissions, maxBuffer, and a 15-second timeout. runner-single-fixture.ts:185-189 evaluates predicates after the isolated executor returns, so this agent-produced analyzer runs from the evaluator process, while cadence-workflow.ts:49-62 permits the cadence to default to host-subprocess execution. Rapid allocation can therefore create host memory pressure before the timeout and synchronously block the daemon.

Evidence:

Evidence 1:



path: src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts

line: 129

excerpt:



> spawnSync applies encoding, killSignal, and stdio settings but establishes no cgroup, rlimit, or equivalent resource boundary.

Evidence 2:



path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 159

excerpt:



> The analyzer options set maxBuffer and a 15000ms timeout only; the Node arguments contain no memory limit.

Evidence 3:



path: src/modules/eval-harness/runner-single-fixture.ts

line: 185

excerpt:



> evaluatePredicates runs after the workflow executor returns, placing analyzer verification outside the executor's container/resource profile.

Evidence 4:



path: src/modules/eval-harness/cadence-workflow.ts

line: 61

excerpt:



> The cadence isolation backend defaults to host-subprocess when no container configuration is supplied.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `.kota/runs/2026-07-25T23-25-05-046Z-builder-3o9p32/security-regression.txt`
  records the resource-control command contract and bounded allocation-pressure
  regression.

## Resolution

Scientific-claim analyzers now fail closed unless the eval uses its configured
Docker-compatible container backend. Verification runs in a fresh offline,
read-only container with a 256 MiB memory-and-swap ceiling, a 0.5 CPU quota and
10-second CPU rlimit, a 32-PID ceiling, a 64-descriptor rlimit, a bounded tmpfs,
no Linux capabilities, and no privilege escalation. The host timeout remains a
secondary control; on timeout or output overflow the exact CID is force-removed.
Container execution, bounded output capture, timeout handling, and CID cleanup
all use asynchronous child processes. Scientific predicate, pre-run, and
calibration callers await that path, so the three cases remain sequential for a
bounded aggregate footprint without blocking the cadence event loop.

The prior native macOS Seatbelt and Linux namespace implementations were
removed because neither could supply the complete hard resource contract.
Predicate evaluation now receives the executor-owned boundary explicitly, so
host-subprocess cadence runs cannot silently execute agent code on the daemon.
Trusted artifact validation also rejects non-regular files and logical sizes
above 256 KiB before reading JSON. This closes the writable result-mount path
where a successful analyzer could otherwise create a huge sparse file for the
cadence host to allocate.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/eval-harness/scientific-claim-analyzer-sandbox.test.ts src/modules/eval-harness/scientific-claim-reproduction-fixture.test.ts src/modules/eval-harness/accepted-alternative-fixtures.test.ts src/modules/eval-harness/predicates.test.ts src/modules/eval-harness/fixture-discovery.test.ts` (5 files, 48 tests passed; the allocation-pressure case proved a timer ran while analyzer execution was still pending)
- `pnpm build`
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/eval-harness` (69 files, 326 tests passed after the asynchronous predicate propagation)
- `node_modules/.bin/tsc --noEmit`
- `node_modules/.bin/biome check` on every touched eval-harness source and test file
- `NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner src/modules/eval-harness/scientific-claim-reproduction-fixture.test.ts src/modules/eval-harness/scientific-claim-analyzer-sandbox.test.ts` (2 files, 10 tests passed; a successful analyzer's 8 GiB sparse result was rejected before host reading)
- `node --conditions=source --import tsx src/validate-queue.ts`
- Repair validation passed the docs-size, instruction-cap, strict-types, and Telegram behavior suites (4 files, 259 tests).
- The equivalent `pnpm validate-tasks` package-script entry was blocked before execution because the offline registry could not verify pnpm 10.32.1; the direct source validator above passed.

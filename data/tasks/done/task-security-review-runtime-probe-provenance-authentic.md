---
id: task-security-review-runtime-probe-provenance-authentic
title: Security review: Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.
status: done
priority: p1
area: security
task_class: Safety
summary: Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.
created_at: 2026-07-26T01:23:53.746Z
updated_at: 2026-07-26T07:37:35.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/critic-runtime-probe.ts
claim:

> Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.

## Desired Outcome

> Run probes through an OS-contained executor with project-scoped filesystem access, network/process/resource restrictions, or explicit owner approval. Do not treat task-command provenance as authorization for transitively resolved workspace scripts. Add a regression proving staged or untracked package code cannot create an outside-workspace marker.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T23-25-05-242Z-security-review-7qz0ka.

finding id: security-review-runtime-probe-workspace-code-execution
candidate id: tool-execution:src/modules/autonomy/critic-runtime-probe.ts:1
verdict: confirmed
rationale:

> Provenance validation reads only the task declaration from git HEAD (task-probe.ts:139-167), while runTaskProbe executes pnpm against the mutable workspace (task-probe.ts:112-121). The focused test creates an untracked package.json whose script runs Node, commits only data/tasks/ready, and successfully executes that script (critic-runtime-probe.test.ts:27-63; critic-test-fixture.integration.ts:84-108). No OS containment or approval boundary is applied.

Evidence:

Evidence 1:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 28

excerpt:



> const provenance = verifyTaskProbeProvenance({ projectDir, taskPath, probe });

Evidence 2:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 35

excerpt:



> ...runTaskProbe(probe, projectDir),

Evidence 3:



path: src/modules/autonomy/task-probe.ts

line: 114

excerpt:



> const result = spawnSync(probe.executable, probe.args, { cwd: projectDir,

Evidence 4:



path: src/modules/autonomy/task-probe.ts

line: 147

excerpt:



> const sourceContent = readHeadFile(args.projectDir, sourcePath);

Evidence 5:



path: src/modules/autonomy/critic-runtime-probe.test.ts

line: 29

excerpt:



> writePackageJson(dir, { "probe:pass": "node -e \"console.log('probe-output-marker')\"" });

Evidence 6:



path: src/modules/autonomy/critic-test-fixture.integration.ts

line: 91

excerpt:



> runGit(dir, ["add", "data/tasks/ready"]);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

Resolved in the builder run
`2026-07-26T00-45-49-336Z-builder-0r71my`. Git-HEAD provenance authenticates
only the task predicate. Mutable package code executes only when a live Linux
Bubblewrap preflight proves an empty mount namespace, network/IPC isolation,
resource limits, a disposable tmpfs workspace overlay, and a PID namespace whose
teardown kills a deliberately detached child. Linux hosts with a piped
`core_pattern` fail closed before package launch because that host handler runs
outside sandbox namespaces despite a zero core limit. Accepted file-pattern
hosts lock `RLIMIT_CORE` at hard zero, then the live capability program execs a
fresh child and requires a deliberate abort to terminate with `SIGABRT`. macOS
and other hosts fail closed as `not-executed`; launcher process-group cleanup is
not a lifetime boundary.

Before launch, every FIFO, pathname socket, device, or other active special
inode rejects the probe regardless of link count because namespaces do not
sever pathname IPC. Regular-file inode link counts still identify workspace
entries with outside names and cover them with nested read-only mounts. Package
writes and newly created pathname IPC live only in Bubblewrap's invisible tmpfs
overlay. The staged and untracked enforced regressions require a passing probe
plus package-originated launch/socket/child-ready evidence. A surviving child
would write to an inherited host-observed pipe, not the invisible overlay.

Fresh verification:

- `node_modules/.bin/tsc --noEmit`
- `NODE_OPTIONS=--conditions=source TMPDIR=/private/tmp node_modules/.bin/vitest run --configLoader runner src/modules/autonomy/task-probe-hard-links.test.ts src/modules/autonomy/task-probe-runner.test.ts src/modules/autonomy/task-probe-sandbox.test.ts src/modules/autonomy/task-probe.test.ts src/modules/autonomy/critic-runtime-probe-sandbox.integration.test.ts src/modules/autonomy/critic-runtime-probe.test.ts` — 6 files, 39 tests passed, and 1 Linux-only pathname-socket test skipped on this macOS host in repair attempt 11. The enforced branch requires a passing probe and package execution evidence; unsupported hosts require explicit failed non-execution.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true` — 1068 files and 12129 tests passed after the final readiness handshake, with 3 files and 14 tests skipped. The only failure was the unrelated registry-dependent pnpm signature check because signed release metadata was unreachable in this environment.
- The same complete-suite command after repair attempt 11 again passed 1068 files and 12129 tests, with 3 files and 15 tests skipped (the additional skip is the Linux-only live pathname-socket case). The only failure remained the unrelated registry-dependent pnpm signature check because signed release metadata was unreachable.
- Repair attempt 13 replaces the invalid pre-exec dumpability claim with the
  fail-closed live `core_pattern` gate, hard-zero core limit, and post-exec abort
  capability check. `task-probe-coredump.integration.test.ts` covers both safe
  Linux outcomes: pipe-handler non-execution or an enforced aborting package.
- Repair-attempt-13 `node_modules/.bin/tsc --noEmit`, focused Biome, queue/diff
  checks, the 8-file Runtime Probe suite (46 tests passed; the Linux coredump
  file and one Linux pathname-socket case skipped on macOS), and the 9-file
  strict-types/layout/docs/task/decision/source-size guard suite (32 tests)
  passed.
- The repair-13 complete suite passed 1,068 files and 12,133 tests, with 4 files
  and 16 tests skipped. Its only failure was the unrelated registry-dependent
  pnpm signature check because signed release metadata was unreachable.

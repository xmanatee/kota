---
status: done
---

# Security review: The eval-harness host subprocess executor forwards the full parent process environment into fixture workflow runs, so any code executing inside the default host-backed workflow subprocess can read operator secrets beyond the explicitly intended eval environment.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/eval-harness/subprocess-executor.ts
claim:

> The eval-harness host subprocess executor forwards the full parent process environment into fixture workflow runs, so any code executing inside the default host-backed workflow subprocess can read operator secrets beyond the explicitly intended eval environment.

## Desired Outcome

> Build the host subprocess environment from an explicit allowlist, such as required runtime basics plus KOTA_DIST_DIR, KOTA_SCOPE_ROOT, HOME, PATH, active preset auth env, and caller-supplied extraEnv. Add regression coverage proving arbitrary parent secrets are absent from host-backed fixture workflow runs while required harness auth still reaches the agent runtime.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Result

`src/modules/eval-harness/subprocess-executor.ts` now builds host subprocess
environment from a small parent-env allowlist, active preset auth env, explicit
`extraEnv`, fixture remaps (`HOME`, `KOTA_SCOPE_ROOT`, `KOTA_DIST_DIR`, `PATH`),
and replay env. The vulnerable `...process.env` spread was removed from the
host-backed execution path.

`src/modules/eval-harness/eval-operations.ts` now passes the active preset auth
env through `extraEnv` so config-selected presets keep required harness auth
without relying on ambient parent env inheritance.

## Source / Intent

Created by security-review workflow run 2026-06-21T07-25-10-625Z-security-review-tk3g4w.

finding id: security-review-eval-host-subprocess-env-leak
candidate id: secret-handling:src/modules/eval-harness/subprocess-executor.ts:682
verdict: confirmed
rationale:

> The default isolation backend is host-subprocess, and that branch passes env: hostExecutionEnv(...) into spawn. hostExecutionEnv builds the child environment by spreading ...process.env before applying extraEnv and fixture overrides, so unrelated parent variables such as API keys or tokens remain visible to workflow code running inside the fixture. Existing tests cover HOME/KOTA_SCOPE_ROOT remapping and container-mode parent-secret exclusion, but not host-subprocess exclusion.

Evidence:

Evidence 1:

path: src/modules/eval-harness/subprocess-executor.ts

line: 954

excerpt:

> const isolationBackend = options.isolationBackend ?? { kind: "host-subprocess" };

Evidence 2:

path: src/modules/eval-harness/subprocess-executor.ts

line: 682

excerpt:

> ...process.env,

Evidence 3:

path: src/modules/eval-harness/subprocess-executor.ts

line: 985

excerpt:

> env: hostExecutionEnv(options, request, hostKotaDistDir),

Evidence 4:

path: src/modules/eval-harness/subprocess-executor.ts

line: 1028

excerpt:

> env: childSpec.env,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm exec vitest run src/modules/eval-harness/subprocess-executor.test.ts` passed: 22 tests, including a host-subprocess regression proving `KOTA_PARENT_SECRET_LEAK_TEST` and unrelated parent `OPENAI_API_KEY` are absent while `ANTHROPIC_API_KEY` for active `KOTA_PRESET=claude` and caller-supplied `extraEnv` are present.
- `pnpm run typecheck` passed.
- `pnpm exec biome check src/modules/eval-harness/subprocess-executor.ts src/modules/eval-harness/subprocess-executor.test.ts src/modules/eval-harness/eval-operations.ts` passed.
- `pnpm run validate-tasks -- --min-ready 0` passed after `git add -A` staged the task move.

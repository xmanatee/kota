---
id: task-security-review-native-cli-agents-can-read-protect
title: Security review: Native CLI agents can read protected project credentials, including the daemon bearer token. The native sandbox recursively exposes the entire workflow cwd while masking only scope-authority operator tokens, bypassing the protected-path policy enforced by KOTA filesystem tools. Untrusted prompt content can therefore cause credentials from `.kota/daemon-control.json`, `.kota/secrets.json`, or `.env*` to enter the native agent and provider context.
status: ready
priority: p1
area: security
task_class: Safety
summary: Native CLI agents can read protected project credentials, including the daemon bearer token. The native sandbox recursively exposes the entire workflow cwd while masking only scope-authority operator tokens, bypassing the protected-path policy enforced by KOTA filesystem tools. Untrusted prompt content can therefore cause credentials from `.kota/daemon-control.json`, `.kota/secrets.json`, or `.env*` to enter the native agent and provider context.
created_at: 2026-08-05T07:39:46.100Z
updated_at: 2026-08-05T07:39:46.100Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/native-cli-sandbox-roots.ts
claim:

> Native CLI agents can read protected project credentials, including the daemon bearer token. The native sandbox recursively exposes the entire workflow cwd while masking only scope-authority operator tokens, bypassing the protected-path policy enforced by KOTA filesystem tools. Untrusted prompt content can therefore cause credentials from `.kota/daemon-control.json`, `.kota/secrets.json`, or `.env*` to enter the native agent and provider context.

## Desired Outcome

> Add canonical read-protected paths to the native sandbox boundary. Deny or mask daemon-control.json, secrets.json, `.env*`, authority credentials, and resolved aliases on both macOS and Linux while preserving ordinary repository and read-only Git metadata access. Add focused native-harness regressions proving these files are unreadable from a project-root cwd.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-05T06-14-25-967Z-security-review-rit42r.

finding id: native-cli-sandbox-exposes-project-runtime-secrets
candidate id: auth-approval-boundary:src/built-cli-daemon.integration.test.ts:22
verdict: confirmed
rationale:

> The native CLI sandbox recursively exposes the workflow cwd, including project-local `.kota` and `.env*` files. macOS denies reads only for scope-authority token paths, while Linux masks only those same tokens; neither implementation protects `.kota/daemon-control.json`, `.kota/secrets.json`, or environment files. Native harnesses bypass KOTA filesystem tool controls, and the daemon control file contains its bearer token. Focused sandbox tests pass and confirm project-root files remain readable.

Evidence:

Evidence 1:



path: src/core/daemon/daemon-startup.ts

line: 75

excerpt:



> writeControlFile(ctx.stateRoot, { port: controlPort, pid: process.pid, startedAt: ctx.state.startedAt, token: ctx.token });

Evidence 2:



path: src/modules/filesystem/protected-paths.ts

line: 13

excerpt:



> KOTA's filesystem boundary explicitly protects `.kota/daemon-control.json` and `.kota/secrets.json`, with `.env` variants excluded from glob and grep access.

Evidence 3:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 144

excerpt:



> nativeCliReadableRoots includes `cwd` as a recursive readable root.

Evidence 4:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 90

excerpt:



> The macOS profile allows every configured readable root and subsequently denies reads only for `protectedTokens`, which are scope-authority token paths.

Evidence 5:



path: src/core/agent-harness/runner.ts

line: 157

excerpt:



> Native harnesses return `{}` from routeKotaToolControlOptions, so they do not receive the KOTA tool controls through which filesystem protected-path checks are enforced.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

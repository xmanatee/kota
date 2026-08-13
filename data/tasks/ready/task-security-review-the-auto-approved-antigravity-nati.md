---
id: task-security-review-the-auto-approved-antigravity-nati
title: Security review: The auto-approved Antigravity native tool loop receives read access to the operator's entire macOS Keychains directory. Untrusted prompts or repository content could induce native tools to query unrelated credentials and expose them through model traffic.
status: ready
priority: p1
area: security
task_class: Safety
summary: The auto-approved Antigravity native tool loop receives read access to the operator's entire macOS Keychains directory. Untrusted prompts or repository content could induce native tools to query unrelated credentials and expose them through model traffic.
created_at: 2026-08-13T13:06:08.341Z
updated_at: 2026-08-13T13:06:08.341Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/antigravity-cli-agent-harness/cli-runner.ts
claim:

> The auto-approved Antigravity native tool loop receives read access to the operator's entire macOS Keychains directory. Untrusted prompts or repository content could induce native tools to query unrelated credentials and expose them through model traffic.

## Desired Outcome

> Do not mount the host's general Keychains directory into an unrestricted native tool loop. Broker AGY authentication outside the agent process or provide an invocation-local credential store containing only AGY's credential; fail closed when narrowly scoped authentication cannot be provided.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-13T10-23-54-194Z-security-review-4thor3.

finding id: agy-host-keychain-exposed-to-native-tool-loop
candidate id: secret-handling:src/modules/antigravity-cli-agent-harness/cli-runner.ts:245
verdict: confirmed
rationale:

> runtime-home.ts:20 resolves the operator's full ~/Library/Keychains directory and lines 39-42 project it into the isolated home. cli-runner.ts:263 bypasses AGY tool approvals, while lines 282-285 grant that directory readable-root status and permit provider egress. adapter.ts:50-65 confirms KOTA cannot restrict or gate individual native tools. Individual item ACLs may limit some plaintext access, but the process can inspect the complete keychain store and query credentials available to its macOS user context, with results able to enter model traffic.

Evidence:

Evidence 1:



path: src/modules/antigravity-cli-agent-harness/runtime-home.ts

line: 20

excerpt:



> return join(env.HOME?.trim() || homedir(), "Library", "Keychains");

Evidence 2:



path: src/modules/antigravity-cli-agent-harness/runtime-home.ts

line: 39

excerpt:



> symlinkSync(keychainDirectory, join(libraryDirectory, "Keychains"), "dir");

Evidence 3:



path: src/modules/antigravity-cli-agent-harness/cli-runner.ts

line: 261

excerpt:



> "--mode", args.readOnly ? "plan" : "accept-edits", "--dangerously-skip-permissions"

Evidence 4:



path: src/modules/antigravity-cli-agent-harness/cli-runner.ts

line: 282

excerpt:



> readOnlyHostRoots: keychainDirectory === undefined ? [] : [keychainDirectory], allowedEgressHosts: ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

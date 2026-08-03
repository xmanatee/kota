---
id: task-security-review-when-kotascopeauthorityoperatortok
title: Security review: When KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH selects a filename other than scope-authority-token.json, filesystem protection does not recognize the operator credential. An agent with file_read access and knowledge of the configured path can read the HMAC credential used to authorize scope trust and policy changes.
status: ready
priority: p1
area: security
task_class: Safety
summary: When KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH selects a filename other than scope-authority-token.json, filesystem protection does not recognize the operator credential. An agent with file_read access and knowledge of the configured path can read the HMAC credential used to authorize scope trust and policy changes.
created_at: 2026-08-03T00:34:23.693Z
updated_at: 2026-08-03T00:34:23.693Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/scope-authority-operator-token.ts
claim:

> When KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH selects a filename other than scope-authority-token.json, filesystem protection does not recognize the operator credential. An agent with file_read access and knowledge of the configured path can read the HMAC credential used to authorize scope trust and policy changes.

## Desired Outcome

> Compare requested and real paths against the actual configured operator-token path, not a basename convention. Pass the authority/token location through filesystem read protection, cover environment-selected arbitrary filenames and aliases, and keep native and KOTA-hosted harness protections aligned.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-02T12-54-03-665Z-security-review-8h4knx.

finding id: scope-authority-custom-token-path-unprotected
candidate id: auth-approval-boundary:src/core/util/real-path.ts:24
verdict: confirmed
rationale:

> The credential path may use any filename through KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH, but protection checks only for the fixed scope-authority-token.json basename. file_read permits absolute paths, and the native harness guards use the same fixed-name assumption.

Evidence:

Evidence 1:



path: src/core/daemon/scope-authority-operator-token.ts

line: 148

excerpt:



> Token-path detection checks only whether the requested or resolved basename equals the fixed TOKEN_FILE_NAME.

Evidence 2:



path: src/core/daemon/scope-authority-operator-token.ts

line: 159

excerpt:



> The actual operator token path may instead come from KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH and may have any filename.

Evidence 3:



path: src/modules/filesystem/protected-paths.ts

line: 86

excerpt:



> Filesystem read protection delegates operator-token recognition solely to isScopeAuthorityOperatorTokenPath.

Evidence 4:



path: src/modules/filesystem/file-read.ts

line: 55

excerpt:



> file_read proceeds unless isProtectedProjectPath recognizes the resolved path.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

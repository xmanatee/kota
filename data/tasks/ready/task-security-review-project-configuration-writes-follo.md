---
id: task-security-review-project-configuration-writes-follo
title: Security review: Project configuration writes follow repository-controlled symbolic links. A malicious project can make `.kota` or `.kota/config.json` point outside the project, causing configuration operations to chmod and rewrite another user-writable directory or file. Webhook secret generation uses this writer, so the behavior can also place a generated secret outside the protected configuration path.
status: ready
priority: p1
area: security
task_class: Safety
summary: Project configuration writes follow repository-controlled symbolic links. A malicious project can make `.kota` or `.kota/config.json` point outside the project, causing configuration operations to chmod and rewrite another user-writable directory or file. Webhook secret generation uses this writer, so the behavior can also place a generated secret outside the protected configuration path.
created_at: 2026-07-24T21:57:53.142Z
updated_at: 2026-07-24T21:57:53.142Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/config/config.ts
claim:

> Project configuration writes follow repository-controlled symbolic links. A malicious project can make `.kota` or `.kota/config.json` point outside the project, causing configuration operations to chmod and rewrite another user-writable directory or file. Webhook secret generation uses this writer, so the behavior can also place a generated secret outside the protected configuration path.

## Desired Outcome

> Reject symbolic links and path escapes for both the project configuration directory and file before chmod, read, or write. Keep the verified destination within the real project root and use a no-follow, atomic regular-file write strategy. Add regressions for malicious `.kota` directory symlinks and `.kota/config.json` file symlinks.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T21-02-26-137Z-security-review-3nq89u.

finding id: project-config-symlink-path-escape
candidate id: task-workflow-mutation:src/core/config/config.ts:7
verdict: confirmed
rationale:

> At src/core/config/config.ts:264-280, updateProjectConfig applies chmod, read, and write operations directly to `.kota` and `.kota/config.json` without rejecting symbolic links. An independent runtime probe confirmed that both directory and file symlinks remain intact while their external targets are chmodded and rewritten. src/modules/webhook/webhook-operations.ts:49-57 persists generated webhook secrets through this vulnerable writer.

Evidence:

Evidence 1:



path: src/core/config/config.ts

line: 264

excerpt:



> const configDir = join(cwd, PROJECT_DIR); const configPath = join(configDir, CONFIG_FILENAME);

Evidence 2:



path: src/core/config/config.ts

line: 269

excerpt:



> chmodSync(configDir, PROJECT_CONFIG_DIR_MODE); ... chmodSync(configPath, PROJECT_CONFIG_FILE_MODE); ... writeFileSync(configPath, ...);

Evidence 3:



path: src/modules/webhook/webhook-operations.ts

line: 49

excerpt:



> const secret = randomBytes(32).toString("hex"); ... updateProjectConfig(ctx.cwd, ...)

Evidence 4:



path: .kota/runs/2026-07-24T21-02-26-137Z-security-review-3nq89u/config-symlink-probe.json

line: 3

excerpt:



> A fresh probe using a `.kota` symlink changed the redirected directory to 0700, changed its config file to 0600, and wrote `model: symlink-write-confirmed` into that redirected file.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

---
id: task-security-review-file-backed-secret-storage-writes-
title: Security review: File-backed secret storage writes raw secret values without restrictive file or directory modes, so .kota/secrets.json permissions depend on the process umask and may be readable by other local users.
status: done
priority: p2
area: security
summary: File-backed secret storage now creates and repairs file-backed secret storage with 0700 directories and 0600 secret files, with focused regression coverage.
created_at: 2026-05-29T00:05:29.646Z
updated_at: 2026-05-29T01:27:11.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/config/secret-providers.ts
claim: File-backed secret storage writes raw secret values without restrictive file or directory modes, so .kota/secrets.json permissions depend on the process umask and may be readable by other local users.

## Desired Outcome

Create secret-store directories with mode 0700, write secret files with mode 0600, repair existing file modes on save/load where possible, and add focused tests for the resulting permissions.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-28T23-56-36-287Z-security-review-09pmyn.

finding id: file-secret-store-default-permissions
candidate id: secret-handling:src/modules/secrets/client.ts:13
verdict: confirmed
rationale: SecretStore uses FileProvider for project and global secrets in src/core/config/secrets.ts:37-43. FileProvider.save creates directories and writes the JSON file at src/core/config/secret-providers.ts:127-131 without mode or chmod, so permissions depend on umask; with the current default umask 022, the equivalent write path creates a 0755 directory and 0644 secrets file.

Evidence:

- src/core/config/secrets.ts:37 - this.projectFileProvider = new FileProvider(
- src/core/config/secrets.ts:41 - this.globalFileProvider = new FileProvider(
- src/core/config/secrets.ts:77 - set(key: string, value: string, scope: SecretScope = "project"): void {
- src/core/config/secret-providers.ts:130 - if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
- src/core/config/secret-providers.ts:131 - writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/core/config/secrets.test.ts`
- `pnpm exec biome check src/core/config/secret-providers.ts src/core/config/secrets.test.ts`
- `pnpm typecheck`

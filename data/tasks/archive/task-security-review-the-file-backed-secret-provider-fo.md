---
status: done
---

# Security review: The file-backed secret provider follows symbolic links when loading, writing, and chmodding .kota/secrets.json. A malicious repository can make that path a symlink to another daemon-user-writable file; a normal secret write then replaces the target with secret JSON and changes its permissions.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/config/secret-providers.ts
claim:

> The file-backed secret provider follows symbolic links when loading, writing, and chmodding .kota/secrets.json. A malicious repository can make that path a symlink to another daemon-user-writable file; a normal secret write then replaces the target with secret JSON and changes its permissions.

## Desired Outcome

> Reject symbolic links in the secret file and every parent component, verify realpath containment under the intended secret directory, and use atomic no-follow file creation and replacement. Add tests proving direct and parent-directory symlinks leave their targets unchanged.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T02-48-33-344Z-security-review-s3q44o.

finding id: file-secret-store-symlink-overwrite
candidate id: secret-handling:src/modules/secrets/client.ts:1
verdict: confirmed
rationale:

> FileProvider still reads, writes, and chmods the configured path without lstat, realpath containment, no-follow opening, or atomic replacement. A current-head probe using secrets.json as a symlink replaced the target's contents with secret JSON and changed its mode from 0644 to 0600. Parent-directory symlinks are likewise unchecked.

Evidence:

Evidence 1:

path: src/core/config/secrets.ts

line: 43

excerpt:

> project: join(projectRoot, ".kota", "secrets.json"),

Evidence 2:

path: src/core/config/secret-providers.ts

line: 116

excerpt:

> this.secureExistingStorage();

Evidence 3:

path: src/core/config/secret-providers.ts

line: 117

excerpt:

> const raw = readFileSync(this.filePath, "utf-8");

Evidence 4:

path: src/core/config/secret-providers.ts

line: 126

excerpt:

> this.data = {};

Evidence 5:

path: src/core/config/secret-providers.ts

line: 135

excerpt:

> writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n", {

Evidence 6:

path: src/core/config/secret-providers.ts

line: 149

excerpt:

> chmodSync(this.filePath, FILE_MODE);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/config src/core/modules/module-context.test.ts src/strict-types-policy.integration.test.ts` passed: 15 files, 162 tests.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint` passed.
- Full `pnpm test` passed 12,186 tests; its sole remaining queue-tracking failure was rerun successfully against the workflow's staged index.

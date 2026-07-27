---
id: task-security-review-the-file-backed-secret-provider-fo
title: Security review: The file-backed secret provider follows symbolic links when loading, writing, and chmodding .kota/secrets.json. A malicious repository can make that path a symlink to another daemon-user-writable file; a normal secret write then replaces the target with secret JSON and changes its permissions.
status: ready
priority: p1
area: security
task_class: Safety
summary: The file-backed secret provider follows symbolic links when loading, writing, and chmodding .kota/secrets.json. A malicious repository can make that path a symlink to another daemon-user-writable file; a normal secret write then replaces the target with secret JSON and changes its permissions.
created_at: 2026-07-27T03:25:52.681Z
updated_at: 2026-07-27T03:25:52.681Z
---

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

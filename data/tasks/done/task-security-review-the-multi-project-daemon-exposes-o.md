---
id: task-security-review-the-multi-project-daemon-exposes-o
title: Security review: The multi-project daemon exposes one process-global SecretStore through unscoped routes and client methods. Selecting another project cannot affect secrets operations, so a client scoped to project B can read, modify, or remove the default project's credentials.
status: done
priority: p1
area: security
task_class: Safety
summary: The multi-project daemon exposes one process-global SecretStore through unscoped routes and client methods. Selecting another project cannot affect secrets operations, so a client scoped to project B can read, modify, or remove the default project's credentials.
created_at: 2026-07-27T03:25:52.665Z
updated_at: 2026-07-27T21:56:14.853Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/secrets/client.ts
claim:

> The multi-project daemon exposes one process-global SecretStore through unscoped routes and client methods. Selecting another project cannot affect secrets operations, so a client scoped to project B can read, modify, or remove the default project's credentials.

## Desired Outcome

> Resolve a SecretStore from a validated project selector for every project-scoped operation, propagate that selector through the client and routes, and reject unknown scopes. Add two-project tests covering list, get, set, and remove isolation.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T02-48-33-344Z-security-review-s3q44o.

finding id: secrets-client-cross-project-default-store
candidate id: secret-handling:src/modules/secrets/client.ts:9
verdict: confirmed
rationale:

> SecretStore remains a process-global singleton initialized with the default module cwd. SecretsClient methods and daemon routes carry no project selector, createProjectScopedKotaClient does not override the secrets namespace, and route handlers always resolve the singleton store. Consequently, selecting project B still performs list, get, set, and remove operations against the default project's store.

Evidence:

Evidence 1:



path: src/modules/secrets/client.ts

line: 44

excerpt:



> list(): Promise<SecretListResult>;

Evidence 2:



path: src/modules/secrets/client.ts

line: 45

excerpt:



> get(name: string): Promise<SecretGetResult>;

Evidence 3:



path: src/modules/secrets/routes.ts

line: 8

excerpt:



> return getSecretStore() ?? initSecretStore();

Evidence 4:



path: src/modules/secrets/routes.ts

line: 41

excerpt:



> jsonResponse(res, 200, { found: true, value });

Evidence 5:



path: src/core/config/secrets.ts

line: 195

excerpt:



> let store: SecretStore | null = null;

Evidence 6:



path: src/modules/secrets/index.ts

line: 379

excerpt:



> initSecretStore(ctx.cwd);

Evidence 7:



path: src/core/daemon/daemon-multi-project-isolation.test.ts

line: 6

excerpt:



> * one daemon hosting two projects produces no cross-project leakage.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- One stable `SecretStore` now belongs to each canonical project runtime.
  Secrets routes and clients require a validated project selector, unknown
  projects fail before store access, and `forProject`/`forScope` propagate the
  selector through list, get, set, and remove.
- The mutable process-global store selector and transport fallbacks were
  removed. Tool-result masking covers values registered by every hosted
  project without granting cross-project read or mutation access.
- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- Focused secrets and recovery regression: 7 files and 66 tests passed,
  including two-project route isolation and strict daemon transport behavior.

---
status: done
---

# Security review: Webhook secrets are written into `.kota/config.json` through the generic config writer, which creates the directory and file without restrictive modes and does not repair existing permissions. Under a standard `022` umask, a fresh CLI generation produced a `0755` `.kota` directory and `0644` secret-bearing config, allowing other local accounts to read the HMAC secret and forge workflow triggers.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/config/config.ts
claim:

> Webhook secrets are written into `.kota/config.json` through the generic config writer, which creates the directory and file without restrictive modes and does not repair existing permissions. Under a standard `022` umask, a fresh CLI generation produced a `0755` `.kota` directory and `0644` secret-bearing config, allowing other local accounts to read the HMAC secret and forge workflow triggers.

## Desired Outcome

> Persist webhook secrets through the restricted secret store, or enforce and repair `0700` directory and `0600` file permissions whenever secret-bearing project configuration is written. Add fresh-file and pre-existing-permission regression tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T18-41-20-702Z-security-review-rg2whe.

finding id: webhook-secret-insecure-project-config-permissions
candidate id: secret-handling:src/modules/webhook/cli.ts:17
verdict: confirmed
rationale:

> Confirmed. `src/modules/webhook/webhook-operations.ts:44` writes the generated HMAC secret through `updateProjectConfig`, whose implementation at `src/core/config/config.ts:251` creates and writes storage without restrictive modes or permission repair. Under umask 022, a fresh probe produced a 0755 directory and 0644 config file; rewriting pre-existing storage preserved those modes.

Evidence:

Evidence 1:

path: src/modules/webhook/webhook-operations.ts

line: 49

excerpt:

> const secret = randomBytes(32).toString("hex");

Evidence 2:

path: src/modules/webhook/webhook-operations.ts

line: 51

excerpt:

> updateProjectConfig(ctx.cwd, (raw) => ({
>     ...raw,
>     webhooks: {
>       ...(raw.webhooks ?? {}),
>       [workflow]: { secret },

Evidence 3:

path: src/core/config/config.ts

line: 259

excerpt:

> if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
>   writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");

Evidence 4:

path: src/modules/webhook/cli.ts

line: 51

excerpt:

> "Generate a cryptographically random secret for a workflow and save it to .kota/config.json",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run src/core/config src/modules/config src/modules/webhook/webhook-operations.test.ts src/modules/webhook/cli.test.ts --configLoader runner --silent=true` — 17 files and 205 tests passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `node_modules/.bin/biome check src/core/config/config.ts src/core/config/project-config-writer.test.ts` — passed.
- `node --conditions=source --import tsx src/validate-queue.ts` — passed against the final canonical staged task state.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run src/task-files.test.ts --configLoader runner --silent=true` — 5 tests passed against the final canonical staged task state.

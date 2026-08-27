---
status: done
---

# Harden project configuration writes against redirected filesystem entries

## Problem

The former pathname-based project-config writer followed repository-controlled
links while changing permissions and content. That allowed a configuration
update to operate beyond the selected project boundary.

severity: high
affected path: src/core/config/config.ts
claim: project configuration writes did not preserve the selected project
filesystem boundary when `.kota` or its config file was a symbolic link.

## Desired Outcome

Reject linked, escaped, replaced, hard-linked, and non-regular destinations
before mutating configuration state. Anchor the transaction to verified
project and config-directory identities, then install a private regular file
atomically.

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

The original evidence is retained in security-review run
`2026-07-24T21-02-26-137Z-security-review-3nq89u`. It identified the old
pathname-based mutation in `src/core/config/config.ts`, the webhook caller in
`src/modules/webhook/webhook-operations.ts`, and a controlled regression probe
showing that the project boundary was not enforced.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run src/core/config src/modules/config src/modules/webhook/webhook-operations.test.ts src/modules/webhook/cli.test.ts src/strict-types-policy.integration.test.ts --configLoader runner --silent=true` — 19 files and 216 tests passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `node_modules/.bin/tsc -p tsconfig.json` plus a direct built-module project-config write/read probe — passed.
- `node_modules/.bin/biome check src/core/config/config.ts src/core/config/project-config-directory-helper-source.ts src/core/config/project-config-directory-helper.ts src/core/config/project-config-writer.ts src/core/config/project-config-writer.test.ts` — passed.
- Focused regressions cover linked and non-regular destinations, replaced
  roots and ancestors before missing-directory creation, a mid-update
  directory replacement, unchanged sentinel contents and modes, and
  serialization failure that preserves the original file.

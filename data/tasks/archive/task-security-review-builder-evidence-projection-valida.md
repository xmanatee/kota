---
status: done
---

# Security review: Builder evidence projection validates sources and destinations by pathname, then accesses those paths again. A concurrent process can replace a checked file or ancestor with a symlink, causing host-side projection to read outside the workspace into durable Git evidence or overwrite and chmod an outside file.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts
claim:

> Builder evidence projection validates sources and destinations by pathname, then accesses those paths again. A concurrent process can replace a checked file or ancestor with a symlink, causing host-side projection to read outside the workspace into durable Git evidence or overwrite and chmod an outside file.

## Desired Outcome

> Use identity-stable, no-follow file operations. Open sources with O_NOFOLLOW, validate and bound them with fstat, read from the same descriptor, and verify stability afterward. Write projections through an O_EXCL|O_NOFOLLOW temporary descriptor in an identity-pinned directory, then atomically install and revalidate them. Fail closed where required primitives are unavailable, with regressions for leaf and parent replacement races.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T08-57-54-091Z-security-review-nun19p.

finding id: finding-builder-evidence-projection-toctou
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/builder/agent-run-artifacts.ts:6
verdict: confirmed
rationale:

> Source validation is pathname-based: agent-run-evidence-policy.ts:145-160 performs lstat and realpath checks before a later readFileSync of the same path, without pinning or revalidating an opened descriptor. Destination handling is similarly raceable: agent-run-artifacts.ts:145-156 checks each directory chain and destination with lstat, then separately calls writeFileSync and chmodSync. A concurrent writer can replace a checked leaf or ancestor between these operations, redirecting the host process outside the workspace. No O_NOFOLLOW, descriptor-based fstat/read/write, identity comparison, or atomic no-follow installation closes either race.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/builder/agent-run-evidence-policy.ts

line: 145

excerpt:

> const stats = lstatSync(file.absolutePath, { throwIfNoEntry: false });

Evidence 2:

path: src/modules/autonomy/workflows/builder/agent-run-evidence-policy.ts

line: 160

excerpt:

> const projectedContent = projectTypedContent(file, readFileSync(file.absolutePath));

Evidence 3:

path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts

line: 146

excerpt:

> const existing = lstatSync(destination, { throwIfNoEntry: false });
> ...
> writeFileSync(destination, file.projectedContent, { mode: 0o600 });
> chmodSync(destination, 0o600);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/autonomy/workflows/builder/agent-run-evidence-filesystem-helper.test.ts src/modules/autonomy/workflows/builder/agent-run-evidence-policy.test.ts src/modules/autonomy/workflows/builder/agent-run-artifacts.test.ts src/modules/autonomy/workflows/builder/agent-run-evidence-projection.test.ts` — passed 4 files / 14 tests.
- `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/biome check src/` — passed.

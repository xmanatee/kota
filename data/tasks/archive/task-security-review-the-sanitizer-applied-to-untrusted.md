---
status: done
---

# Security review: The sanitizer applied to untrusted approval and owner-question rows has quadratic worst-case behavior for repeated unterminated OSC introducers, so a sufficiently large crafted value can stall operator UI rendering.

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/rendering/safe-terminal-text.ts
claim:

> The sanitizer applied to untrusted approval and owner-question rows has quadratic worst-case behavior for repeated unterminated OSC introducers, so a sufficiently large crafted value can stall operator UI rendering.

## Desired Outcome

> Replace the backtracking escape-sequence expression with a bounded single-pass scanner and impose reasonable rendering input limits. Add an adversarial regression using repeated unterminated ESC-OSC and C1-OSC prefixes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-01T09-09-41-035Z-security-review-pxj6wc.

finding id: terminal-control-sanitizer-quadratic-scan
candidate id: auth-approval-boundary:src/modules/workflow-ops/ui-surface.test.ts:91
verdict: confirmed
rationale:

> safe-terminal-text.ts:1-3 searches forward for an OSC terminator from every unterminated ESC-OSC prefix, producing quadratic behavior. Benchmarks against the current exported sanitizer took approximately 3.2, 12.6, 49.8, and 199.4 ms for 4, 8, 16, and 32 KiB inputs—about fourfold growth per doubling. operator-ui-render.ts:24-25 and 145 applies this sanitizer to table values supplied by ui-runtime-helpers.ts:108-130. Canonical owner questions are capped at 500 characters, limiting that path, but PendingApproval strings and persisted projections have no comparable boundary limit, so the low-severity denial-of-service condition remains.

Evidence:

Evidence 1:

path: src/modules/rendering/safe-terminal-text.ts

line: 3

excerpt:

> /(?:\x1b\][\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x9d[\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x1b\[[0-?]*[ -/]*[@-~])|(?:\x9b[0-?]*[ -/]*[@-~])|(?:\x1b[@-_])/g;

Evidence 2:

path: src/modules/rendering/safe-terminal-text.ts

line: 10

excerpt:

> .replace(TERMINAL_ESCAPE_SEQUENCE_PATTERN, "")

Evidence 3:

path: src/modules/workflow-ops/ui-runtime-helpers.ts

line: 116

excerpt:

> { columnId: "detail", value: `${approval.tool}  ${approval.reason}`, role: "muted" },

Evidence 4:

path: src/modules/daemon-ops/operator-ui-render.ts

line: 145

excerpt:

> spans: [terminalSpan(`${cell?.value ?? ""}${rowAction}`, cell?.role ?? column.role)],

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/rendering/safe-terminal-text.test.ts src/modules/workflow-ops/ui-surface.test.ts` — 2 files and 7 tests passed, including repeated unterminated ESC-OSC and C1-OSC input through the approval and owner-question rendering boundary.
- `./node_modules/.bin/biome check src/modules/rendering/safe-terminal-text.ts src/modules/rendering/safe-terminal-text.test.ts src/modules/workflow-ops/ui-surface.test.ts` and `./node_modules/.bin/tsc --noEmit` — passed.

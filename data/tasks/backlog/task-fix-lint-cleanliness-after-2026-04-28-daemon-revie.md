---
id: task-fix-lint-cleanliness-after-2026-04-28-daemon-revie
title: Fix lint cleanliness after 2026-04-28 daemon review
status: backlog
priority: p3
area: core
summary: Make pnpm lint and pnpm --dir clients/web lint pass with no warnings/errors by fixing the specific items the 2026-04-28 daemon review surfaced, without weakening accessibility or removing meaningful test coverage.
created_at: 2026-04-28T22:04:53.408Z
updated_at: 2026-04-28T22:04:53.408Z
---

## Problem

The 2026-04-28 broad daemon review found the repo is green on typecheck,
build, tests, and task validation, but not clean on lint. Specific failures:

- `clients/web` lint failure in `SlashCommandPalette.tsx`: the custom
  listbox is not focusable, Biome suggests semantic elements, and the
  `useEffect` dependency list is flagged.
- Root `pnpm lint` warnings: unused imports in
  `src/core/loop/context-pipeline.test.ts`, unused `exitSpy` variables in
  `src/modules/retract/cli.test.ts`, and unused imports in
  `src/modules/slack-channel/index.test.ts`.

## Desired Outcome

Both `pnpm lint` and `pnpm --dir clients/web lint` pass with no warnings or
errors. Accessibility is preserved or improved (the listbox issue is fixed
structurally rather than by suppressing the rule). No meaningful test
coverage is removed; unused symbols are removed only when they are actually
unused.

## Constraints

- Do not weaken accessibility. Fix the listbox structurally (semantic
  elements / focus handling) rather than disabling the Biome rule.
- Do not delete tests or test scenarios. Unused imports and variables can
  be removed; covered behavior must remain covered.
- Do not introduce broad lint suppressions. If a specific suppression is
  needed, it must be local with a documented reason.
- The fix lives entirely in lint cleanup and adjacent structural fixes; do
  not bundle unrelated refactors.

## Done When

- `pnpm lint` exits clean with no warnings or errors.
- `pnpm --dir clients/web lint` exits clean with no warnings or errors.
- The `SlashCommandPalette.tsx` listbox is focusable and uses semantic
  elements; the `useEffect` dependency list is correct.
- The unused symbols flagged by lint are removed (or, where genuinely
  needed, their usage is restored).

## Source / Intent

2026-04-28 broad daemon review (verbatim): "Broad daemon review on
2026-04-28 found that the repo is green on typecheck, build, tests, and
task validation, but not clean on lint. Work needed: Fix `clients/web`
lint failure in `SlashCommandPalette.tsx`: the custom listbox is not
focusable, Biome suggests semantic elements, and the `useEffect` dependency
list is flagged. Fix root `pnpm lint` warnings: unused imports in
`src/core/loop/context-pipeline.test.ts`, unused `exitSpy` variables in
`src/modules/retract/cli.test.ts`, and unused imports in
`src/modules/slack-channel/index.test.ts`. Desired outcome: `pnpm lint` and
`pnpm --dir clients/web lint` both pass with no warnings/errors, without
weakening accessibility or deleting meaningful test coverage."

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Run-directory artifact (or commit transcript) showing `pnpm lint` and
  `pnpm --dir clients/web lint` both exit clean after the change.

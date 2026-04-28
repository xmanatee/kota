# Fix lint cleanliness after daemon review

Source / intent: Broad daemon review on 2026-04-28 found that the repo is
green on typecheck, build, tests, and task validation, but not clean on lint.

Work needed:

- Fix `clients/web` lint failure in `SlashCommandPalette.tsx`: the custom
  listbox is not focusable, Biome suggests semantic elements, and the
  `useEffect` dependency list is flagged.
- Fix root `pnpm lint` warnings: unused imports in
  `src/core/loop/context-pipeline.test.ts`, unused `exitSpy` variables in
  `src/modules/retract/cli.test.ts`, and unused imports in
  `src/modules/slack-channel/index.test.ts`.

Desired outcome: `pnpm lint` and `pnpm --dir clients/web lint` both pass with
no warnings/errors, without weakening accessibility or deleting meaningful
test coverage.

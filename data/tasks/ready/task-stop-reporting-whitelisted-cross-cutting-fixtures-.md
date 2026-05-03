---
id: task-stop-reporting-whitelisted-cross-cutting-fixtures-
title: Stop reporting whitelisted cross-cutting fixtures as root-kernel-helper architecture debt
status: ready
priority: p2
area: architecture
summary: Align listRootKernelHelperDebt with the root-layout fixture whitelist so legitimate cross-cutting shared fixtures (e.g. conversational-cross-store-fixture.integration.ts) stop being reported as architecture debt and stop distorting autonomy queue-shaping.
created_at: 2026-05-03T04:02:19.968Z
updated_at: 2026-05-03T04:02:19.968Z
---

## Problem

`listRootKernelHelperDebt` in
`src/modules/repo-tasks/task-queue-validation.ts:343-352` filters out
`*.test.ts` and `*.integration.test.ts` from `src/*.ts` but treats every
other root-level `.ts` file as architecture debt unless it appears in
`ROOT_SRC_KNOWN_ENTRYPOINTS`. That set lists only entrypoints
(`cli.ts`, `init.ts`, `module-api.ts`, `validate-queue.ts`).

It does **not** know about cross-cutting shared fixtures, even though
`src/AGENTS.md` (`Root Layout` section) and the `CROSS_CUTTING_FIXTURES`
whitelist in `src/root-layout.test.ts:47` explicitly authorize them at
the root. The single current example,
`src/conversational-cross-store-fixture.integration.ts`, uses the
`.integration.ts` extension (not `.integration.test.ts`) precisely because
it is a fixture, not a test, and is consumed by two cross-subsystem tests
(`src/conversational-agent-tools.integration.test.ts`,
`src/conversational-prompt-priming.integration.test.ts`). The root-layout
test passes; the queue validator nevertheless reports it as debt and
fires `architecture-ready-coverage` against the autonomy queue.

This is not benign noise. The check is a hard repair-loop gate on
`explorer`. The 2026-05-03 explorer run
(`.kota/runs/2026-05-03T03-53-49-141Z-explorer-8cbp7s/`) failed both
`architecture-ready-coverage` and `strategic-ready-coverage` because of
this single phantom-debt signal — every blocked architecture alternative
was correctly gated, the queue had no actual debt to attack, but the
validator forced a synthetic ready architecture task into existence.
The same condition will keep firing on every empty-queue cycle until
the validator is taught about the existing whitelist.

## Desired Outcome

`listRootKernelHelperDebt` and `src/root-layout.test.ts` agree on what
counts as a root-level helper that needs migration. A file that the
root-layout policy explicitly authorizes as a cross-cutting fixture
must not appear in the queue validator's "architecture debt" list and
must not trip `architecture-ready-coverage`.

There is exactly one source of truth for the cross-cutting fixture
whitelist; both the layout test and the queue validator read from it
(or the queue validator imports the layout test's set). Adding a new
authorized fixture does not require editing two unrelated files.

## Constraints

- Single source of truth. Do not duplicate the fixture list across
  `src/root-layout.test.ts` and `src/modules/repo-tasks/task-queue-validation.ts`.
  Pick one home and import it from both, or factor the rule into a
  small shared helper.
- The new helper / shared set lives where it belongs by ownership, not
  by minimum-diff. The root-layout policy is what authorizes these
  files; the queue validator is the consumer.
- Preserve the existing real signal. Genuine root-kernel debt (a new
  unauthorized `.ts` at `src/`) must still be reported by
  `listRootKernelHelperDebt` and must still trip
  `architecture-ready-coverage` when no strategic ready architecture
  task exists.
- Do not loosen the root-layout test. The `.integration.ts` extension
  and the `CROSS_CUTTING_FIXTURES` whitelist are working as intended.
- Do not regress `assertArchitectureReadyCoverage` /
  `assertStrategicReadyCoverage` semantics — this is purely a
  classifier fix.

## Done When

1. **Phantom debt removed.** `listVisibleArchitectureDebt(projectDir)`
   no longer returns `src/conversational-cross-store-fixture.integration.ts`
   when run against this repo, while the file still exists at the root
   (i.e. the validator changed, not the file location).
2. **Whitelist is shared.** Adding a new entry to the cross-cutting
   fixture whitelist requires editing exactly one file. Both the
   root-layout test and the queue validator pick it up.
3. **Real debt still detected.** A unit test in
   `src/modules/repo-tasks/` adds a fake unauthorized `src/<name>.ts`
   in a temp project root and asserts `listRootKernelHelperDebt`
   reports it; adds the same name to the shared whitelist and asserts
   it disappears from the report.
4. **Repair-loop check exercised.** A unit test asserts that with no
   strategic ready architecture task, the only debt being a
   whitelisted fixture causes `assertArchitectureReadyCoverage` to
   pass (no throw).
5. **No new strict-types-policy regressions.** Baseline counts unchanged.
6. **Existing tests stay green.** `src/root-layout.test.ts`,
   `src/modules/repo-tasks/task-queue-validation.test.ts`, and the full
   typecheck/test pass.

## Source / Intent

Surfaced by the explorer run
`.kota/runs/2026-05-03T03-53-49-141Z-explorer-8cbp7s/` (post-check
repair attempt 2). The repair-loop forced creation of a strategic
architecture ready task because the validator's debt list is out of
sync with the policy `src/AGENTS.md` and `src/root-layout.test.ts`
already encode. Fixing the validator is the structural answer; without
it, the repair loop will keep manufacturing synthetic architecture
tasks every time the queue empties out.

## Initiative

Module-first architecture & autonomy queue-shaping correctness:
keep validator-driven repair-loop signals aligned with the actual
root-layout policy so autonomy spends its iterations on real debt,
not phantom debt manufactured by classifier drift.

## Acceptance Evidence

- A focused vitest under `src/modules/repo-tasks/` (e.g.
  `task-queue-validation.test.ts`) that:
  - constructs a temp project root containing a whitelisted
    `*.integration.ts` fixture and asserts
    `listVisibleArchitectureDebt` returns `[]`;
  - constructs a temp project root containing a non-whitelisted
    `src/<name>.ts` and asserts the file is reported;
  - asserts `assertArchitectureReadyCoverage` does not throw when
    the only "debt" is a whitelisted fixture and ready/ has no
    architecture task.
- `pnpm test` and `pnpm typecheck` (or repo-equivalent) green,
  captured to a builder run-directory transcript.
- A short note in `src/AGENTS.md` / `src/modules/repo-tasks/AGENTS.md`
  if the shared-whitelist location warrants pointer documentation;
  do not duplicate the file list in prose.

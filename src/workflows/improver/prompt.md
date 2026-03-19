Your job is to improve the autonomous development system, not to do ordinary feature work unless that is the best process fix.

## Primary Inputs

- The most recent builder run in `.kota/runs/` and the triggering builder run described in the workflow trigger payload
- Other recent workflow runs when they reveal a pattern
- `NOTES.md` (`i:` items matter)
- `BUILDER_LESSONS.md`
- `CHANGELOG.md`
- The workflow definitions in `src/workflows/`
- The runtime and validation code that governs workflow runs
- `src/workflows/improver/improvement-thesis.md`

## What Good Improvements Look Like

- Stronger protocols and validation around autonomous behavior
- Simpler, more reliable triggering or artifact handling
- Better prompts when the current ones create drift or weak decisions
- Missing tests around the workflow flow
- Removal of brittle mechanisms that create maintenance cost without real value

## Working Rules

- Start from evidence. Use recent runs and current code, not guesswork.
- Prefer fixes that make future builder and improver runs more robust, more legible, or more honest.
- Avoid metric theater and avoid adding analysis machinery unless it changes decisions.
- Do not keep stale mechanisms alive for compatibility. If a path is obsolete, remove it.
- Validate the specific behavior you change while you work. This workflow will run final `npm run typecheck`, `npm run test:workflow-critical`, and `npm run build` after your step, then request a runtime restart so future workflows run against the rebuilt code.
- If you change the repo, create a git commit before finishing.

## Scope

You may edit workflow prompts, workflow definitions, runtime code, tests, docs, logging, or validation if that is the highest-leverage process improvement.

If the builder is repeatedly missing something, fix the conditions around the builder rather than restating the same advice.

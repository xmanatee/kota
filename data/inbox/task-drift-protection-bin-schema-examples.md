---
id: task-drift-protection-bin-schema-examples
title: Drift protection for bin/, schema/, and examples/
status: inbox
priority: p2
area: build
summary: bin/, schema/, and examples/ serve external users (CLI install, IDE config help, KEMP authors, CI integrators). Several drift paths are unprotected and one has already silently drifted.
created_at: 2026-04-15T15:25:00.000Z
updated_at: 2026-04-15T15:25:00.000Z
---

## Problem

Four distributable surfaces each have a specific drift mode; only one is partially guarded.

1. **`schema/kota-config.schema.json` has already drifted.** Source `KotaConfig` (`src/core/config/config.ts:15`) defines 34 top-level fields; schema has 31. Missing: `budget`, `failover`, `tracing`. The existing check at `src/modules/config/config.test.ts:346-364` cannot catch this — its `knownKeys` reference list is hand-maintained and drifts in lockstep with the schema, not the source type.
2. **`schema/AGENTS.md:5` claims "Covers all 27 config fields"** — stale literal count.
3. **`examples/modules/kota-demo-http.js` has no end-to-end coverage.** Only the Python demo is spawned (`src/foreign-module-loader.test.ts:17`). KEMP protocol changes would break the HTTP demo silently.
4. **`bin/kota.mjs` has no test.** If `dist/cli.js` output path or the `package.json.bin` mapping changes, an `npm i -g` install breaks with no CI signal.
5. **`examples/github-actions/kota-trigger.yml` has no test.** Env var names and webhook path are unverified against the webhook module; rename would silently invalidate the published example.

## Desired Outcome

- The JSON Schema is generated from `KotaConfig`, not hand-maintained. Drift becomes impossible by construction.
- Every published example is exercised end-to-end OR statically checked against the code it claims to integrate with.
- The `bin/` entry point has a minimal post-build sanity check.
- `schema/AGENTS.md` describes purpose, not inventory counts.

## Constraints

- Do not hand-edit `schema/kota-config.schema.json` after this task — it must be generated.
- Do not replace the stale "27 fields" claim with "34 fields". Remove the count entirely; counts are a recurring drift vector.
- Tests must not require network or a running daemon. Static parsing plus in-process spawning only.
- Follow existing test layout (`*.test.ts` colocated in `src/`, vitest runner).

## Done When

- `schema/kota-config.schema.json` is produced by a `build:schema` script from `src/core/config/config.ts`. The committed file matches generator output; a test fails on mismatch.
- The `knownKeys` hardcoded list in `src/modules/config/config.test.ts:353-360` is removed; the schema-coverage test derives its reference from the source type or the generator.
- `src/foreign-module-http.test.ts` spawns `examples/modules/kota-demo-http.js` through a full init → invoke → shutdown handshake.
- A test reads `package.json.bin.kota`, resolves the target, and asserts the file exists and its `import` target resolves to a source or built artifact that exists.
- A test parses `examples/github-actions/kota-trigger.yml`, extracts referenced env var names and the webhook path shape, and asserts they match constants exported from the webhook module.
- `schema/AGENTS.md:5` no longer cites a field count.

## Plan

1. Add `ts-json-schema-generator` dev dep; implement `pnpm build:schema` that emits `schema/kota-config.schema.json` from `KotaConfig`. Regenerate; the new file must add `budget`, `failover`, `tracing`.
2. Replace the `knownKeys` list in `config.test.ts` with a diff test: regenerate into a temp path, byte-compare to committed schema, fail on drift.
3. Extend `foreign-module-http.test.ts` to cover the HTTP demo, mirroring the Python demo coverage in `foreign-module-loader.test.ts:40`.
4. Add `src/bin-entry.test.ts` (or colocate with package metadata tests) — one test per assertion above.
5. Add `src/examples-github-actions.test.ts` — parse YAML, cross-check against exported webhook constants.
6. Prune the field-count sentence in `schema/AGENTS.md`.

# Mobile Typecheck Observability Evidence

- `clients/mobile/scripts/typecheck.mjs` now emits JSON-line status logs with `source`, `level`, `message`, `status`, and relevant fields for dependency-skip, dependency-failure, git-inspection failure, compiler start, and compiler completion paths.
- `src/modules/autonomy/observability-obligation.test.ts` includes a focused assertion that a `clients/mobile/scripts/typecheck.mjs` staged diff with structured status logging satisfies the observability-obligation diagnostic.
- Verification run: `pnpm test src/modules/autonomy/observability-obligation.test.ts` passed with 6 tests.
- Runtime wrapper check: `pnpm --dir clients/mobile typecheck` passed and emitted a structured `kota-mobile-typecheck` JSON warning for the no-staged-mobile-app-paths skip path.
- Final staged diagnostic evidence is recorded in `observability-obligation-review.json`: outcome `ok`, satisfied file `clients/mobile/scripts/typecheck.mjs`, and `missingFiles: []`.

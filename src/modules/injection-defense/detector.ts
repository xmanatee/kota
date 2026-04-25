/**
 * Re-export of the core structural injection-pattern detector. The detector
 * primitive lives in `src/core/util/injection-detector.ts` so it can also be
 * used by core consumers (notably the workflow ask-owner step pattern that
 * screens operator answers before they reach a resuming agent step's trigger
 * envelope) without importing from a module. This module's public surface is
 * the tool middleware in `defense-middleware.ts`; the detector re-export
 * keeps existing callers and tests stable.
 */

export { detectInjection, type InjectionVerdict } from "#core/util/injection-detector.js";

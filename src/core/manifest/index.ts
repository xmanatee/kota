/**
 * Manifest API — public re-exports.
 *
 * All manifest functionality is split across focused submodules:
 * - types.ts      — ManifestToolDef, ModuleManifest, etc.
 * - validation.ts — validateManifest
 * - steps.ts      — resolveRef, resolveStepInput, evaluateCondition (shared step utilities)
 * - execution.ts  — manifestToModule
 * - persistence.ts — saveManifest, loadManifest, discoverManifestModules
 */


export { manifestToModule } from "./execution.js";
export {
	deleteManifest,
	discoverManifestModules,
	listManifestModules,
	loadManifest,
	saveManifest,
} from "./persistence.js";

export {
	evaluateCondition,
	getFieldByPath,
	resolveRef,
	resolveStepInput,
} from "./steps.js";
export type {
	ManifestToolDef,
	ModuleManifest,
	ValidationError,
} from "./types.js";
export { validateManifest } from "./validation.js";

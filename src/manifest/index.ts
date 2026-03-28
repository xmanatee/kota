/**
 * Manifest module — public API re-exports.
 *
 * All manifest functionality is split across focused submodules:
 * - types.ts      — ManifestToolDef, ExtensionManifest, etc.
 * - validation.ts — validateManifest
 * - steps.ts      — resolveRef, resolveStepInput, evaluateCondition (shared step utilities)
 * - execution.ts  — manifestToExtension
 * - persistence.ts — saveManifest, loadManifest, discoverManifestExtensions
 */


export { manifestToExtension } from "./execution.js";
export {
	deleteManifest,
	discoverManifestExtensions,
	listManifestExtensions,
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
	ExtensionManifest,
	ManifestToolDef,
	ValidationError,
} from "./types.js";
export { validateManifest } from "./validation.js";

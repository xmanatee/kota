/**
 * Module Factory — re-export facade.
 *
 * The implementation lives in src/manifest/ (types, validation, steps,
 * execution, persistence). This file re-exports everything for backward
 * compatibility with existing consumers.
 */


export type {
	ManifestEventHandler,
	ManifestScriptDef,
	ManifestStepDef,
	ManifestToolDef,
	ModuleManifest,
	ValidationError,
} from "./manifest/index.js";
export {
	deleteManifest,
	discoverManifestModules,
	evaluateCondition,
	getFieldByPath,
	listManifestModules,
	loadManifest,
	manifestToModule,
	resolveRef,
	resolveStepInput,
	runModuleScript,
	saveManifest,
	validateManifest,
} from "./manifest/index.js";

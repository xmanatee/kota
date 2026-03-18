/**
 * Module Factory Tool — re-export facade.
 *
 * The implementation lives in src/tools/module-factory/ (definition, state,
 * actions, scripts, logs). This file re-exports everything for backward
 * compatibility with existing consumers.
 */

export {
	getLoadedManifestModuleCount,
	markModuleLoaded,
	moduleFactoryTool,
	registration,
	resetModuleFactory,
	runModuleFactory,
} from "./module-factory/index.js";

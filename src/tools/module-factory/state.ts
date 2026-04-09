/**
 * Module Factory — session state tracking.
 *
 * Tracks which manifest modules are currently loaded in this session.
 */

const loadedManifestModules = new Set<string>();

export const MAX_MANIFEST_MODULES = 10;

export function isModuleLoaded(name: string): boolean {
	return loadedManifestModules.has(name);
}

export function loadedModuleCount(): number {
	return loadedManifestModules.size;
}

export function addLoadedModule(name: string): void {
	loadedManifestModules.add(name);
}

export function removeLoadedModule(name: string): void {
	loadedManifestModules.delete(name);
}


/** Clear state. For testing. */
export function resetModuleFactory(): void {
	loadedManifestModules.clear();
}

/** Iterate loaded module names. Used by list handler for session-only detection. */
export function loadedModuleNames(): Iterable<string> {
	return loadedManifestModules;
}

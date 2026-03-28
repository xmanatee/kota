/**
 * Extension Factory — session state tracking.
 *
 * Tracks which manifest extensions are currently loaded in this session.
 */

const loadedManifestExtensions = new Set<string>();

export const MAX_MANIFEST_MODULES = 10;

export function isExtensionLoaded(name: string): boolean {
	return loadedManifestExtensions.has(name);
}

export function loadedExtensionCount(): number {
	return loadedManifestExtensions.size;
}

export function addLoadedExtension(name: string): void {
	loadedManifestExtensions.add(name);
}

export function removeLoadedExtension(name: string): void {
	loadedManifestExtensions.delete(name);
}

/** Track an extension as loaded in this session (called during startup discovery). */
export function markExtensionLoaded(name: string): void {
	loadedManifestExtensions.add(name);
}

/** Get count of loaded manifest extensions. For testing. */
export function getLoadedManifestExtensionCount(): number {
	return loadedManifestExtensions.size;
}

/** Clear state. For testing. */
export function resetExtensionFactory(): void {
	loadedManifestExtensions.clear();
}

/** Iterate loaded extension names. Used by list handler for session-only detection. */
export function loadedExtensionNames(): Iterable<string> {
	return loadedManifestExtensions;
}

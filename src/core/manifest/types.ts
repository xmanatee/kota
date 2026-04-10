/**
 * Manifest type definitions — declarative JSON schema for agent-authored modules.
 */

import type { Language } from "../../repl-session.js";

export type ManifestToolDef = {
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
	code: string;
	language?: Language;
	group?: string;
};

export type ModuleManifest = {
	name: string;
	version?: string;
	description?: string;
	tools?: ManifestToolDef[];
	dependencies?: string[];
};

export type ValidationError = { field: string; message: string };

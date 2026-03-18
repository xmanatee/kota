/**
 * Manifest type definitions — declarative JSON schema for agent-authored modules.
 */

import type { Language } from "../repl-session.js";

export type ManifestToolDef = {
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
	code: string;
	language?: Language;
	group?: string;
};

/** A single tool invocation step in a step-based event handler. */
export type ManifestStepDef = {
	/** Tool name to invoke (must be a registered tool). */
	tool: string;
	/**
	 * Input to pass to the tool. String values support references:
	 * - "$prev" → previous step's output (whole value)
	 * - "$payload" → serialized payload/args (whole value)
	 * - "$steps[N]" → step N's output (whole value)
	 * - "$prev.field.path" → JSON field from previous output
	 * - "$steps[N].field.path" → JSON field from step N's output
	 * - "$payload.field.path" → field from payload object
	 * - "text {{$prev.field}} more" → inline template interpolation
	 */
	input?: Record<string, unknown>;
	/**
	 * Guard condition — step is skipped when this evaluates to falsy.
	 * Supports references ($prev, $steps[N], $payload) with .field access,
	 * comparisons (==, !=, >, <, >=, <=), and bare truthiness checks.
	 * Examples: "$prev.status == ok", "$steps[0].count > 0", "$prev"
	 */
	if?: string;
};

export type ManifestEventHandler = {
	/** Event name to subscribe to (e.g. "schedule:fire", "process:exit"). */
	event: string;
	/** Code to run when the event fires. Receives `event_name` and `payload` variables. Mutually exclusive with `steps`. */
	code?: string;
	/** Language for code execution (default: "python"). */
	language?: Language;
	/** Sequential tool invocations to run when the event fires. Mutually exclusive with `code`. */
	steps?: ManifestStepDef[];
};

/** A named, on-demand sequence of tool calls that a module exposes. */
export type ManifestScriptDef = {
	/** Human-readable description of what the script does. */
	description?: string;
	/** Sequential tool invocations. Each step's output feeds into the next via "$prev". */
	steps: ManifestStepDef[];
};

export type ModuleManifest = {
	name: string;
	version?: string;
	description?: string;
	tools?: ManifestToolDef[];
	promptSection?: string;
	dependencies?: string[];
	/** Event handlers — subscribe to bus events and run code when they fire. */
	eventHandlers?: ManifestEventHandler[];
	/** Named scripts — reusable tool-call sequences invokable on demand. */
	scripts?: Record<string, ManifestScriptDef>;
};

export type ValidationError = { field: string; message: string };

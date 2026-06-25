import type { Transport } from '#core/loop/transport.js';

export interface ReplChrome {
	/** Announce the chosen harness and model once at REPL entry. */
	announceHarness(harness: { name: string; description: string }, model: string): void;
	/** Print the `/help` table of slash commands and descriptions. */
	showHelp(commands: Record<string, string>): void;
	/** Print the `/status` snapshot (harness, model, project, turn count). */
	showStatus(harness: string, model: string, turns: number, projectDir?: string): void;
	/** Confirm a `/reset` or `/clear` of the transcript. */
	showReset(): void;
	/** Paint an error message raised during a turn. */
	showError(message: string): void;
	/** Print the footer on REPL exit. */
	showGoodbye(): void;
}

/** Severity level for operator-facing terminal diagnostics. */
export type TerminalDiagnosticLevel = "info" | "warn" | "error" | "debug";

/** A human-facing diagnostic line emitted by core through the rendering seam. */
export type TerminalDiagnostic = {
	level: TerminalDiagnosticLevel;
	message: string;
	detail?: string;
};

/** Interactive prompts that core tools ask the rendering module to paint. */
export type TerminalPrompt =
	| { kind: "question"; question: string }
	| {
			kind: "confirmation";
			action: string;
			risk: "low" | "medium" | "high";
			details?: string;
			timeoutSeconds: number;
		};

/**
 * Rendering service — the module-owned seam core uses to paint
 * operator-facing surfaces without importing `#modules/rendering/*`.
 * The rendering module registers a default implementation during
 * `onLoad`; deployments without the rendering module receive `null`
 * from `getRenderingProvider()` and must degrade to a neutral path
 * (e.g. `NullTransport`, a `ReplChrome`-less refusal).
 */
export interface RenderingProvider {
	/** Build the default CLI transport for an agent session. */
	createAgentTransport(options: { verbose: boolean; showCost: boolean }): Transport;
	/** Build the REPL chrome surface used for banners, help, and errors. */
	createReplChrome(): ReplChrome;
	/** Print a core/runtime diagnostic to stderr through the rendering module. */
	printDiagnostic(diagnostic: TerminalDiagnostic): void;
	/** Print an interactive prompt to stderr through the rendering module. */
	printPrompt(prompt: TerminalPrompt): void;
	/** Forward raw stderr chunks through the rendering transport for passthrough streams. */
	writeStderr(text: string): void;
}

/**
 * Per-million-token rate columns for a single pricing tier. Strict: every
 * field must be present for a registered tier. Modules that own model clients
 * register complete pricing entries through the model-pricing provider seam —
 * the seam itself never returns a partial record.
 */

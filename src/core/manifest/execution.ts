/**
 * Manifest execution — converts manifests to KotaModule objects.
 */

import type { KotaToolInputSchema } from "#core/agent-harness/message-protocol.js";
import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { type CodeLanguage, runCode } from "#core/tools/code-runner.js";
import { localWriteEffect } from "#core/tools/effect.js";
import type { ToolRunner } from "#core/tools/index.js";
import type { ManifestToolDef, ModuleManifest } from "./types.js";

// ─── Tool runner builder ─────────────────────────────────────────────

function buildToolRunner(
	toolDef: ManifestToolDef,
): ToolRunner {
	const lang: CodeLanguage = toolDef.language || "python";
	return async (input, context) => {
		const { output, isError } = await runCode(lang, toolDef.code, input, undefined, context);
		return { content: output, is_error: isError };
	};
}

// ─── Manifest → KotaModule conversion ────────────────────────────────

export function manifestToModule(manifest: ModuleManifest): KotaModule {
	const tools: ToolDef[] = (manifest.tools || []).map((t) => ({
		tool: {
			name: t.name,
			description: t.description,
			input_schema: (t.parameters || {
				type: "object" as const,
				properties: {},
			}) as KotaToolInputSchema,
		},
		runner: buildToolRunner(t),
		group: t.group,
		effect: localWriteEffect(),
	}));

	return {
		name: manifest.name,
		version: manifest.version || "1.0.0",
		description: manifest.description,
		dependencies: manifest.dependencies,
		tools: tools.length > 0 ? tools : undefined,
	};
}

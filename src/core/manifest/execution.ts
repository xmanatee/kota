/**
 * Manifest execution — converts manifests to KotaModule objects.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "#core/tools/code-wrappers.js";
import type { Language } from "#core/tools/repl-session.js";
import { sessions } from "#core/tools/repl-session.js";
import type { ManifestToolDef, ModuleManifest } from "./types.js";

// ─── Tool runner builder ─────────────────────────────────────────────

function buildToolRunner(
	toolDef: ManifestToolDef,
): (input: Record<string, unknown>) => Promise<{ content: string; is_error?: boolean }> {
	const lang: Language = toolDef.language || "python";
	return async (input) => {
		const paramsJson = JSON.stringify(input);
		const b64 = Buffer.from(paramsJson).toString("base64");

		const wrapper =
			lang === "python"
				? `import json as __j, base64 as __b\nparams = __j.loads(__b.b64decode('${b64}').decode())\n${toolDef.code}`
				: `const params = JSON.parse(Buffer.from('${b64}','base64').toString());\n${toolDef.code}`;

		const session = sessions[lang];
		const { output, isError } = await session.execute(
			wrapper,
			DEFAULT_TIMEOUT,
		);

		const truncated =
			output.length > MAX_OUTPUT
				? `${output.slice(0, MAX_OUTPUT)}\n[truncated — ${output.length} chars total]`
				: output;

		return { content: truncated, is_error: isError };
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
			}) as Anthropic.Tool["input_schema"],
		},
		runner: buildToolRunner(t),
		group: t.group,
		risk: "moderate",
		kind: "action",
	}));

	return {
		name: manifest.name,
		version: manifest.version || "1.0.0",
		description: manifest.description,
		dependencies: manifest.dependencies,
		tools: tools.length > 0 ? tools : undefined,
	};
}

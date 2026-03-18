import type Anthropic from "@anthropic-ai/sdk";
import { queryOS, queryResources, queryRuntimes, queryServices } from "./env-probes.js";
import type { ToolRegistration, ToolResult } from "./index.js";

export const envInfoTool: Anthropic.Tool = {
	name: "env_info",
	description:
		"Discover the host environment: OS, installed runtimes, running services, " +
		"and system resources (disk, memory, CPU, GPU). Use before DevOps tasks, " +
		"dependency installation, or when you need to know what's available.",
	input_schema: {
		type: "object" as const,
		properties: {
			query: {
				type: "string",
				enum: ["os", "runtimes", "services", "resources", "all"],
				description:
					"What to discover. os: platform, arch, shell, user. " +
					"runtimes: installed languages and package managers. " +
					"services: listening ports, Docker, databases. " +
					"resources: CPU, memory, disk, GPU. all: everything.",
			},
		},
		required: ["query"],
	},
};

const QUERIES: Record<string, () => Promise<string>> = {
	os: queryOS,
	runtimes: queryRuntimes,
	services: queryServices,
	resources: queryResources,
};

export async function runEnvInfo(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const query = (input.query as string) || "all";

	if (query === "all") {
		const sections = await Promise.all(
			Object.values(QUERIES).map((fn) => fn()),
		);
		return { content: sections.join("\n\n") };
	}

	const handler = QUERIES[query];
	if (!handler) {
		return {
			content: `Unknown query: ${query}. Valid: ${Object.keys(QUERIES).join(", ")}, all`,
			is_error: true,
		};
	}

	return { content: await handler() };
}

export const registration: ToolRegistration = {
	tool: envInfoTool,
	runner: runEnvInfo,
	risk: "safe" as const,
};

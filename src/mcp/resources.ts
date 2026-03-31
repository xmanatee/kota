/**
 * MCP resource definitions and readers for KOTA state.
 *
 * Exposes three read-only resources over the MCP protocol:
 *   kota://tasks/ready          – task queue snapshot
 *   kota://workflow/status      – runtime state summary
 *   kota://workflow/runs/recent – 10 most recent run summaries
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkflowRunStore } from "../workflow/run-store.js";

export type McpResource = {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
};

export const KOTA_RESOURCES: McpResource[] = [
	{
		uri: "kota://tasks/ready",
		name: "Ready Tasks",
		description: "Tasks in tasks/ready/ with id, title, priority, and summary.",
		mimeType: "application/json",
	},
	{
		uri: "kota://workflow/status",
		name: "Workflow Status",
		description:
			"Current paused state, active run count, and per-workflow last-run status.",
		mimeType: "application/json",
	},
	{
		uri: "kota://workflow/runs/recent",
		name: "Recent Workflow Runs",
		description: "The 10 most recent workflow run summaries.",
		mimeType: "application/json",
	},
];

export const KNOWN_RESOURCE_URIS = new Set(KOTA_RESOURCES.map((r) => r.uri));

function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return fields;
}

function readReadyTasks(projectDir: string): unknown {
	const dir = join(projectDir, "tasks", "ready");
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	const tasks = [];
	for (const file of files) {
		const content = readFileSync(join(dir, file), "utf-8");
		const fm = parseFrontmatter(content);
		if (fm.id && fm.title) {
			tasks.push({
				id: fm.id,
				title: fm.title,
				priority: fm.priority ?? "",
				summary: fm.summary ?? "",
			});
		}
	}
	return tasks;
}

function readWorkflowStatus(projectDir: string): unknown {
	const store = new WorkflowRunStore(projectDir);
	const state = store.readState();
	const perWorkflow: Record<string, unknown> = {};
	for (const [name, ws] of Object.entries(state.workflows)) {
		perWorkflow[name] = {
			lastStatus: ws.lastStatus ?? null,
			lastRunId: ws.lastRunId ?? null,
			lastCompletedAt: ws.lastCompletedAt ?? null,
			nextScheduledAt: ws.nextScheduledAt ?? null,
		};
	}
	return {
		activeRunCount: (state.activeRuns ?? []).length,
		paused: !!state.agentBackoff,
		workflows: perWorkflow,
	};
}

function readRecentRuns(projectDir: string): unknown {
	const store = new WorkflowRunStore(projectDir);
	const runs = store.listRuns({ limit: 10 });
	return runs.map((r) => ({
		id: r.id,
		workflow: r.workflow,
		status: r.status,
		totalCostUsd: r.totalCostUsd ?? null,
		durationMs: r.durationMs ?? null,
		startedAt: r.startedAt,
		completedAt: r.completedAt ?? null,
	}));
}

/**
 * Read the content for a known resource URI.
 * Returns null if the URI is not recognized.
 */
export function readKotaResource(
	uri: string,
	projectDir: string,
): string | null {
	switch (uri) {
		case "kota://tasks/ready":
			return JSON.stringify(readReadyTasks(projectDir), null, 2);
		case "kota://workflow/status":
			return JSON.stringify(readWorkflowStatus(projectDir), null, 2);
		case "kota://workflow/runs/recent":
			return JSON.stringify(readRecentRuns(projectDir), null, 2);
		default:
			return null;
	}
}

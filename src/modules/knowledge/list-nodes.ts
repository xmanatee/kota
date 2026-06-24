import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import { formatWorkMemoryMetadata } from "#core/modules/work-memory-metadata.js";
import {
	type ColumnsNode,
	columns,
	type SemanticRole,
} from "#modules/rendering/primitives.js";

export type KnowledgeRow = {
	id: string;
	title: string;
	type: string;
	status: string;
	updated: string;
	metadata: string;
};

export function formatKnowledgeDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

export function knowledgeStatusRole(status: string): SemanticRole {
	switch (status) {
		case "active":
			return "success";
		case "archived":
			return "muted";
		case "draft":
			return "warn";
		default:
			return "info";
	}
}

export function toKnowledgeRow(entry: KnowledgeEntry): KnowledgeRow {
	return {
		id: entry.id,
		title: entry.title,
		type: entry.type,
		status: entry.status,
		updated: entry.updated,
		metadata: formatWorkMemoryMetadata({
			...(entry.provenance && { provenance: entry.provenance }),
			...(entry.freshness && { freshness: entry.freshness }),
		}),
	};
}

export function buildKnowledgeListNode(entries: KnowledgeRow[]): ColumnsNode {
	return columns(
		[
			{ header: "ID", role: "accent" },
			{ header: "Type" },
			{ header: "Status", minWidth: 6 },
			{ header: "Updated" },
			{ header: "Title", maxWidth: 60 },
			{ header: "Metadata", maxWidth: 72 },
		],
		entries.map((e) => ({
			cells: [
				{ spans: [{ text: e.id, role: "accent" }] },
				{ spans: [{ text: e.type }] },
				{ spans: [{ text: e.status, role: knowledgeStatusRole(e.status) }] },
				{ spans: [{ text: formatKnowledgeDate(e.updated), role: "muted" }] },
				{ spans: [{ text: e.title }] },
				{ spans: [{ text: e.metadata, role: "muted" }] },
			],
		})),
	);
}

export function buildKnowledgeSearchNode(entries: KnowledgeRow[]): ColumnsNode {
	return columns(
		[
			{ header: "ID", role: "accent" },
			{ header: "Type" },
			{ header: "Title", maxWidth: 80 },
			{ header: "Metadata", maxWidth: 72 },
		],
		entries.map((e) => ({
			cells: [
				{ spans: [{ text: e.id, role: "accent" }] },
				{ spans: [{ text: e.type }] },
				{ spans: [{ text: e.title }] },
				{ spans: [{ text: e.metadata, role: "muted" }] },
			],
		})),
	);
}

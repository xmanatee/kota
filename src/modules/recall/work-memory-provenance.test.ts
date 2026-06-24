import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { createMemoryContributor as createMemoryRetractContributor } from "#modules/retract/contributors.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import {
	createKnowledgeContributor,
	createMemoryContributor,
} from "./contributors.js";
import { RecallProviderImpl } from "./recall-provider.js";
import { renderRecallHitsPlain } from "./render.js";

describe("work-memory provenance through recall", () => {
	let root: string;
	let memory: MemoryStore;
	let knowledge: KnowledgeStore;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "kota-recall-provenance-"));
		memory = new MemoryStore(join(root, ".kota"));
		knowledge = new KnowledgeStore(root, join(root, "global-data"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("recalls, corrects, and retracts memory with visible provenance signals", async () => {
		const memoryId = memory.save(
			"provenance recall cadence belongs in reviewable memory",
			["provenance"],
			{
				provenance: {
					sourceKind: "run",
					sourceId: "run-provenance",
					observedAt: "2026-04-25T08:00:00.000Z",
				},
			},
		);
		const knowledgeId = knowledge.create({
			title: "Reviewable recall provenance",
			content: "provenance recall entries should cite source files",
			provenance: {
				sourceKind: "file",
				sourcePath: "docs/ARCHITECTURE.md",
				observedAt: "2026-04-26T12:34:56.000Z",
			},
			freshness: { status: "current" },
		});

		const recall = new RecallProviderImpl({ onContributorError: () => {} });
		recall.register(createMemoryContributor(memory));
		recall.register(createKnowledgeContributor(knowledge));

		const before = await recall.recall("provenance recall", { topK: 10 });
		expect(before.map((hit) => `${hit.source}:${hit.id}`)).toEqual(
			expect.arrayContaining([`memory:${memoryId}`, `knowledge:${knowledgeId}`]),
		);
		expect(renderRecallHitsPlain(before)).toContain(
			"run:run-provenance observed 2026-04-25; current",
		);

		memory.update(memoryId, {
			freshness: {
				status: "superseded",
				changedAt: "2026-04-27T09:15:00.000Z",
				replacementId: "mem-replacement",
			},
		});
		const corrected = await recall.recall("provenance recall", { topK: 10 });
		expect(renderRecallHitsPlain(corrected)).toContain(
			"superseded -> mem-replacement 2026-04-27",
		);

		const retract = new RetractProviderImpl();
		retract.register(createMemoryRetractContributor(memory));
		await expect(
			retract.retract({ target: "memory", id: memoryId }),
		).resolves.toMatchObject({
			ok: true,
			record: { target: "memory", recordId: memoryId },
		});

		const after = await recall.recall("provenance recall", { topK: 10 });
		expect(after.some((hit) => hit.source === "memory" && hit.id === memoryId)).toBe(false);
		expect(after.some((hit) => hit.source === "knowledge" && hit.id === knowledgeId)).toBe(true);
	});
});

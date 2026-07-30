import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	approvalFilePath,
	approvalFilePathForItem,
	projectApprovalForStorage,
} from "./approval-queue-projection.js";
import type { PendingApproval } from "./approval-queue-types.js";

export class ApprovalQueueStore {
	constructor(private readonly dir: string) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}

	get(id: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path || !existsSync(path)) return null;
		return this.read(path);
	}

	list(): PendingApproval[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((file) => file.endsWith(".json"))
			.map((file) => this.read(join(this.dir, file)));
	}

	write(item: PendingApproval): PendingApproval {
		const projected = projectApprovalForStorage(item);
		writeFileSync(
			approvalFilePathForItem(this.dir, projected),
			JSON.stringify(projected, null, 2),
		);
		return projected;
	}

	clear(): void {
		if (!existsSync(this.dir)) return;
		for (const file of readdirSync(this.dir).filter((candidate) => candidate.endsWith(".json"))) {
			unlinkSync(join(this.dir, file));
		}
	}

	private read(path: string): PendingApproval {
		const item = JSON.parse(readFileSync(path, "utf-8")) as PendingApproval;
		if (typeof item.scopeId !== "string" || item.scopeId.length === 0) {
			throw new Error(`Malformed approval record at ${path}: missing scopeId`);
		}
		return projectApprovalForStorage(item);
	}
}

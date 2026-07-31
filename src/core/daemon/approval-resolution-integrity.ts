import {
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { projectApprovalForStorage } from "./approval-queue-projection.js";
import type { PendingApproval } from "./approval-queue-types.js";
import type { ApprovalRecordRepository } from "./approval-record-repository.js";
import type { ApprovalFileIdentity } from "./approval-record-storage.js";

const KEY_ID_PATTERN = /^[0-9a-f]{32}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type ApprovalResolutionIntegrity = {
	version: 1;
	algorithm: "hmac-sha256";
	keyId: string;
	digest: string;
};

export function isTerminalApprovalStatus(
	status: PendingApproval["status"],
): boolean {
	return status !== "pending";
}

export function isApprovalResolutionIntegrity(
	value: ApprovalResolutionIntegrity | undefined,
): value is ApprovalResolutionIntegrity {
	return value !== undefined
		&& value !== null
		&& typeof value === "object"
		&& value.version === 1
		&& value.algorithm === "hmac-sha256"
		&& typeof value.keyId === "string"
		&& KEY_ID_PATTERN.test(value.keyId)
		&& typeof value.digest === "string"
		&& DIGEST_PATTERN.test(value.digest);
}

export class ApprovalResolutionIntegrityError extends Error {
	constructor(approvalId: string) {
		super(
			`Approval ${approvalId} integrity cannot authenticate its pending snapshot or terminal resolution for this daemon lifetime`,
		);
		this.name = "ApprovalResolutionIntegrityError";
	}
}

function payload(item: PendingApproval): string {
	return JSON.stringify(projectApprovalForStorage(item));
}

export class ApprovalResolutionAuthenticator {
	private readonly key = randomBytes(32);
	private readonly keyId = randomBytes(16).toString("hex");
	private readonly pendingDigests = new Map<string, string>();

	registerPending(item: PendingApproval): void {
		if (isTerminalApprovalStatus(item.status)) {
			throw new Error(`Cannot register terminal approval ${item.id} as pending`);
		}
		this.pendingDigests.set(item.id, this.digest(item));
	}

	assertPendingAuthentic(item: PendingApproval): void {
		const expected = this.pendingDigests.get(item.id);
		if (
			isTerminalApprovalStatus(item.status)
			|| expected === undefined
			|| !this.digestsMatch(expected, this.digest(item))
		) {
			throw new ApprovalResolutionIntegrityError(item.id);
		}
	}

	create(item: PendingApproval): ApprovalResolutionIntegrity {
		if (!isTerminalApprovalStatus(item.status)) {
			throw new Error(`Cannot authenticate pending approval ${item.id}`);
		}
		return {
			version: 1,
			algorithm: "hmac-sha256",
			keyId: this.keyId,
			digest: this.digest(item),
		};
	}

	read(
		records: ApprovalRecordRepository,
		id: string,
	): PendingApproval | null {
		const stored = records.read(id);
		if (stored === null) return null;
		if (stored.item.status === "pending") {
			this.assertPendingAuthentic(stored.item);
		} else {
			this.assertValid(stored.item, stored.resolutionIntegrity);
		}
		return stored.item;
	}

	write(
		records: ApprovalRecordRepository,
		item: PendingApproval,
		expectedIdentity: ApprovalFileIdentity,
	): PendingApproval {
		const stored = records.write(item, expectedIdentity, this.create(item));
		this.pendingDigests.delete(item.id);
		return stored;
	}

	clear(): void {
		this.pendingDigests.clear();
	}

	assertValid(
		item: PendingApproval,
		integrity: ApprovalResolutionIntegrity | undefined,
	): void {
		if (
			!isTerminalApprovalStatus(item.status)
			|| !isApprovalResolutionIntegrity(integrity)
			|| integrity.keyId !== this.keyId
		) {
			throw new ApprovalResolutionIntegrityError(item.id);
		}
		if (!this.digestsMatch(this.digest(item), integrity.digest)) {
			throw new ApprovalResolutionIntegrityError(item.id);
		}
	}

	private digest(item: PendingApproval): string {
		return createHmac("sha256", this.key).update(payload(item)).digest("hex");
	}

	private digestsMatch(expected: string, actual: string): boolean {
		return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
	}
}

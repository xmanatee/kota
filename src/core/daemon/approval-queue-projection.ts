import { join } from "node:path";
import {
	cloneEvidenceJsonObject,
	type EvidenceProjectionTarget,
	projectEvidenceJsonValueAsDataClass,
	projectEvidenceText,
	redactSensitiveText,
} from "#core/evidence/policy.js";
import type {
	ApprovalClientProjection,
	ApprovalToolIoRedaction,
	PendingApproval,
} from "./approval-queue.js";

const APPROVAL_ID_PATTERN = /^[0-9a-f]{8}$/;

export function isApprovalId(id: string): boolean {
	return APPROVAL_ID_PATTERN.test(id);
}

export function projectApprovalForClient(
	item: PendingApproval,
	target: EvidenceProjectionTarget = "daemon-api",
): ApprovalClientProjection {
	const projected: ApprovalClientProjection = {
		...projectApprovalTextFields(item),
		input: projectApprovalInputForTarget(item.input, target),
	};
	if (item.context !== undefined) {
		const context = projectEvidenceText(item.context, target, "tool-io");
		if (typeof context === "string") {
			projected.context = context;
		} else {
			projected.context = "[redacted]";
			projected.contextRedaction = {
				redacted: true,
				reason: "tool-io",
				...(context.bytes !== undefined ? { bytes: context.bytes } : {}),
			};
		}
	}
	return projected;
}

export function approvalFilePath(dir: string, id: string): string | null {
	return isApprovalId(id) ? join(dir, `${id}.json`) : null;
}

export function approvalFilePathForItem(dir: string, item: PendingApproval): string {
	const path = approvalFilePath(dir, item.id);
	if (!path) throw new Error(`Malformed approval id: ${item.id}`);
	return path;
}

export function projectApprovalForStorage(item: PendingApproval): PendingApproval {
	const projected: PendingApproval = {
		...projectApprovalTextFields(item),
		input: projectApprovalInputForStorage(item.input),
	};
	if (item.context !== undefined) {
		delete projected.context;
		projected.contextRedaction = projectApprovalContextForStorage(item.context);
	}
	return projected;
}

function projectApprovalInputForStorage(input: PendingApproval["input"]): PendingApproval["input"] {
	if (isToolIoRedactionRecord(input)) return input;
	const projected = projectApprovalInputForTarget(input, "internal-storage");
	if (!isToolIoRedactionRecord(projected)) {
		throw new Error("Approval input storage projection must redact tool I/O");
	}
	return projected;
}

function projectApprovalTextFields(item: PendingApproval): PendingApproval {
	const projected: PendingApproval = {
		...item,
		reason: redactSensitiveText(item.reason),
	};
	if (item.source !== undefined) projected.source = redactSensitiveText(item.source);
	if (item.approvalNote !== undefined) {
		projected.approvalNote = redactSensitiveText(item.approvalNote);
	}
	if (item.rejectionReason !== undefined) {
		projected.rejectionReason = redactSensitiveText(item.rejectionReason);
	}
	if (item.resolutionSource !== undefined) {
		projected.resolutionSource = redactSensitiveText(item.resolutionSource);
	}
	return projected;
}

function projectApprovalInputForTarget(
	input: PendingApproval["input"],
	target: EvidenceProjectionTarget,
): PendingApproval["input"] {
	const projected = projectEvidenceJsonValueAsDataClass(
		cloneEvidenceJsonObject(input),
		target,
		"tool-io",
	);
	if (typeof projected !== "object" || projected === null || Array.isArray(projected)) {
		throw new Error("Approval input projection must remain an object");
	}
	return projected;
}

function projectApprovalContextForStorage(context: string): ApprovalToolIoRedaction {
	const projected = projectEvidenceText(context, "internal-storage", "tool-io");
	if (typeof projected === "string" || projected.reason !== "tool-io") {
		throw new Error("Approval context storage projection must redact tool I/O");
	}
	return {
		redacted: true,
		reason: "tool-io",
		...(projected.bytes !== undefined ? { bytes: projected.bytes } : {}),
	};
}

function isToolIoRedactionRecord(
	value: PendingApproval["input"],
): value is ApprovalToolIoRedaction & PendingApproval["input"] {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		value.redacted === true &&
		value.reason === "tool-io"
	);
}

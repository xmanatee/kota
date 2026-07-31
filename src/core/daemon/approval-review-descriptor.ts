import { createHash } from "node:crypto";
import {
	cloneEvidenceJsonObject,
	EVIDENCE_REDACTED,
	type EvidenceJsonObject,
	type EvidenceJsonValue,
} from "#core/evidence/policy.js";
import { redactApprovalShortCredentialArgument } from "#core/tools/approval-command-redaction.js";
import {
	isSensitiveToolInputKey,
	redactApprovalCredentialArgumentValue,
	redactApprovalCredentialText,
} from "#core/tools/approval-redaction.js";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type {
	ApprovalKind,
	ApprovalLocalToolDeclaration,
} from "./approval-queue-types.js";

export type ApprovalReviewBinding = {
	id: string;
	kind: ApprovalKind;
	tool: string;
	scopeId: string;
	risk: RiskLevel;
	reason: string;
	source?: string;
	sessionId?: string;
	localToolDeclaration?: ApprovalLocalToolDeclaration;
};

export type ApprovalReviewDescriptor = {
	status: "available";
	input: EvidenceJsonObject;
	context?: string;
	localToolDeclaration?: ApprovalLocalToolDeclaration;
	digest: string;
};

export type ApprovalReviewUnavailable = {
	status: "unavailable";
	reason: "input_unavailable";
};

function isEvidenceJsonObject(value: EvidenceJsonValue): value is EvidenceJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSensitiveNamedValue(value: EvidenceJsonObject): boolean {
	for (const discriminator of [value.name, value.key]) {
		if (
			typeof discriminator === "string"
			&& isSensitiveToolInputKey(discriminator)
		) {
			return true;
		}
	}
	return false;
}

function isNamedValueDiscriminator(key: string): boolean {
	return key.toLowerCase() === "name" || key.toLowerCase() === "key";
}

const REVIEWABLE_NAMED_VALUE_METADATA_KEYS = new Set([
	"action",
	"operation",
	"path",
	"target",
]);

function isReviewableNamedValueMetadata(key: string): boolean {
	return isNamedValueDiscriminator(key)
		|| REVIEWABLE_NAMED_VALUE_METADATA_KEYS.has(key.toLowerCase());
}

function findArgumentCommand(value: EvidenceJsonObject): string | undefined {
	for (const key of ["command", "cmd", "executable", "program", "file", "binary"]) {
		const candidate = value[key];
		if (typeof candidate === "string") return candidate;
	}
	return undefined;
}

function isArgumentListKey(key: string): boolean {
	return ["args", "argv", "arguments"].includes(key.toLowerCase());
}

function projectApprovalReviewValue(
	value: EvidenceJsonValue,
	key = "",
	argumentCommand?: string,
): EvidenceJsonValue {
	if (isSensitiveToolInputKey(key)) return EVIDENCE_REDACTED;
	if (typeof value === "string") return redactApprovalCredentialText(value);
	if (Array.isArray(value)) {
		const redactPairValue = value.length === 2
			&& typeof value[0] === "string"
			&& isSensitiveToolInputKey(value[0]);
		return value.map((entry, index) => {
			if (redactPairValue && index === 1) return EVIDENCE_REDACTED;
			if (typeof entry === "string") {
				const redacted = redactApprovalShortCredentialArgument(
					entry,
					argumentCommand,
				);
				if (redacted !== undefined) return redacted;
			}
			const precedingEntry = value[index - 1];
			if (typeof precedingEntry === "string" && typeof entry === "string") {
				const redacted = redactApprovalCredentialArgumentValue(
					precedingEntry,
					entry,
					argumentCommand,
				);
				if (redacted !== undefined) return redacted;
			}
			return projectApprovalReviewValue(entry);
		});
	}
	if (!isEvidenceJsonObject(value)) return value;

	const redactNamedPayload = hasSensitiveNamedValue(value);
	const command = findArgumentCommand(value);
	const projected: EvidenceJsonObject = {};
	for (const [entryKey, entryValue] of Object.entries(value)) {
		if (entryValue === undefined) continue;
		Object.defineProperty(projected, entryKey, {
			value: redactNamedPayload && !isReviewableNamedValueMetadata(entryKey)
				? EVIDENCE_REDACTED
				: projectApprovalReviewValue(
					entryValue,
					entryKey,
					isArgumentListKey(entryKey) ? command : undefined,
				),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return projected;
}

export function createApprovalReviewDescriptor(
	approval: ApprovalReviewBinding,
	input: object,
	context?: string,
): ApprovalReviewDescriptor {
	const projected = projectApprovalReviewValue(cloneEvidenceJsonObject(input));
	if (!isEvidenceJsonObject(projected)) {
		throw new Error("Approval review input projection must remain an object");
	}
	const projectedContext = context === undefined
		? undefined
		: redactApprovalCredentialText(context);
	const digestPayload = {
		approval: {
			id: approval.id,
			kind: approval.kind,
			tool: approval.tool,
			scopeId: approval.scopeId,
			risk: approval.risk,
			reason: approval.reason,
			...(approval.source !== undefined ? { source: approval.source } : {}),
			...(approval.sessionId !== undefined ? { sessionId: approval.sessionId } : {}),
			...(approval.localToolDeclaration !== undefined
				? { localToolDeclaration: { ...approval.localToolDeclaration } }
				: {}),
		},
		input: projected,
		...(projectedContext !== undefined ? { context: projectedContext } : {}),
	};
	return {
		status: "available",
		input: projected,
		...(projectedContext !== undefined ? { context: projectedContext } : {}),
		...(approval.localToolDeclaration !== undefined
			? { localToolDeclaration: { ...approval.localToolDeclaration } }
			: {}),
		digest: createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex"),
	};
}

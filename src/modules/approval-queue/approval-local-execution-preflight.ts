import {
	type ApprovalClientProjection,
	type ApprovalExecutionSnapshot,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import {
	leaseLocalToolForApproval,
} from "#core/tools/local-tool-approval-binding.js";
import { validateToolCallInputAgainstSchema } from "#core/tools/tool-input-validation.js";
import type { ApprovalExecutionLease } from "./approval-execution-leases.js";

export type LocalApprovalFailureReason =
	| "local_approval_missing_declaration"
	| "local_tool_unavailable_since_review"
	| "local_tool_registration_changed_since_review"
	| "local_tool_declaration_effect_changed_since_review"
	| "local_tool_input_invalid";

export type LocalApprovalFailureBody = {
	error: string;
	reason: LocalApprovalFailureReason;
	approvals: ApprovalClientProjection[];
	local: {
		tool: string;
		reviewedRegistrationGeneration?: number;
		currentRegistrationGeneration?: number | null;
		reviewedDeclarationEffectFingerprintPrefix?: string;
		currentDeclarationEffectFingerprintPrefix?: string | null;
		message?: string;
	};
};

export type LocalApprovalExecutionPreflight =
	| { ok: true; lease: ApprovalExecutionLease }
	| { ok: false; status: 409; body: LocalApprovalFailureBody };

function fingerprintPrefix(fingerprint: string): string {
	return fingerprint.slice(0, 12);
}

function failureBody(
	reason: LocalApprovalFailureReason,
	item: PendingApproval,
	detail: LocalApprovalFailureBody["local"],
): LocalApprovalFailureBody {
	return {
		error: "Local tool approval cannot be executed",
		reason,
		approvals: [projectApprovalForClient(item)],
		local: detail,
	};
}

export function prepareLocalApprovalExecution(
	snapshot: ApprovalExecutionSnapshot,
): LocalApprovalExecutionPreflight {
	const item = snapshot.approval;
	const declaration = item.localToolDeclaration;
	if (declaration === undefined) {
		return {
			ok: false,
			status: 409,
			body: failureBody("local_approval_missing_declaration", item, {
				tool: item.tool,
				message: "Queued local approval is missing registration metadata.",
			}),
		};
	}
	const leased = leaseLocalToolForApproval(
		item.tool,
		snapshot.executionInput,
		declaration,
	);
	if (!leased.ok) {
		const reasons = {
			tool_unavailable: "local_tool_unavailable_since_review",
			registration_changed: "local_tool_registration_changed_since_review",
			declaration_effect_changed:
				"local_tool_declaration_effect_changed_since_review",
		} as const;
		return {
			ok: false,
			status: 409,
			body: failureBody(reasons[leased.reason], item, {
				tool: item.tool,
				reviewedRegistrationGeneration: declaration.registrationGeneration,
				currentRegistrationGeneration:
					leased.currentDeclaration?.registrationGeneration ?? null,
				reviewedDeclarationEffectFingerprintPrefix:
					fingerprintPrefix(declaration.declarationEffectFingerprint),
				currentDeclarationEffectFingerprintPrefix:
					leased.currentDeclaration === undefined
						? null
						: fingerprintPrefix(
							leased.currentDeclaration.declarationEffectFingerprint,
						),
			}),
		};
	}
	const validation = validateToolCallInputAgainstSchema(
		item.tool,
		snapshot.executionInput,
		leased.lease.tool.input_schema,
	);
	if (!validation.ok) {
		return {
			ok: false,
			status: 409,
			body: failureBody("local_tool_input_invalid", item, {
				tool: item.tool,
				reviewedRegistrationGeneration: declaration.registrationGeneration,
				currentRegistrationGeneration:
					leased.lease.declaration.registrationGeneration,
				reviewedDeclarationEffectFingerprintPrefix:
					fingerprintPrefix(declaration.declarationEffectFingerprint),
				currentDeclarationEffectFingerprintPrefix:
					fingerprintPrefix(
						leased.lease.declaration.declarationEffectFingerprint,
					),
				message: redactSensitiveText(validation.error),
			}),
		};
	}
	return {
		ok: true,
		lease: { ...snapshot.descriptor, localTool: leased.lease },
	};
}

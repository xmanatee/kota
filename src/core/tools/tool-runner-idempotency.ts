import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import type { ToolResult } from "./index.js";
import {
	idempotencyMeta,
	providerWriteIdempotencyInput,
	toolResultFromProjection,
	toolResultProjection,
} from "./tool-idempotency.js";
import type { ToolUseBlock } from "./tool-runner-types.js";

export async function executeToolWithIdempotency(
	block: ToolUseBlock,
	input: ToolCallInput,
	idempotencyStore: IdempotencyStore | undefined,
	executeWithMiddleware: () => Promise<ToolResult>,
): Promise<ToolResult> {
	const idempotency = idempotencyStore
		? providerWriteIdempotencyInput(
			block,
			input,
			idempotencyStore.getDefaultScopeId(),
		)
		: null;
	if (!idempotency) return executeWithMiddleware();
	const claim = idempotencyStore!.claim({
		scopeId: idempotency.scopeId,
		operation: "provider-write",
		key: idempotency.key,
		parameterFingerprint: idempotency.parameterFingerprint,
	});
	if (claim.status === "replayed") {
		return {
			...toolResultFromProjection(claim.result, block.name),
			_meta: idempotencyMeta("replayed", idempotency.key),
		};
	}
	if (claim.status === "ignored") {
		return {
			content: `Ignored duplicate in-flight provider write for ${block.name} (${idempotency.key})`,
			_meta: idempotencyMeta("ignored", idempotency.key),
			is_error: true,
		};
	}
	if (claim.status === "expired") {
		return {
			content: `Expired provider write idempotency key for ${block.name}: retry can claim fresh work`,
			_meta: idempotencyMeta("expired", idempotency.key),
			is_error: true,
		};
	}
	if (claim.status === "rejected") {
		return {
			content: `Rejected duplicate provider write for ${block.name}: idempotency key reused with different parameters`,
			_meta: idempotencyMeta("rejected", idempotency.key),
			is_error: true,
		};
	}
	const executed = await executeWithMiddleware();
	idempotencyStore!.complete(claim.reservation, toolResultProjection(block, executed));
	return {
		...executed,
		_meta: {
			...(executed._meta ?? {}),
			...idempotencyMeta("accepted", idempotency.key),
		},
	};
}

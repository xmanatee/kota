import type { KotaJsonObject, KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import {
  fingerprintIdempotencyParams,
  hashIdempotencyMaterial,
  type IdempotencyJsonObject,
} from "#core/daemon/idempotency-store.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import type { ToolResult } from "./index.js";
import { getToolEffect } from "./index.js";

type ToolUseBlock = KotaToolUseBlock;

export type ProviderWriteIdempotencyInput = {
  scopeId: string;
  key: string;
  parameterFingerprint: string;
};

function stringInput(input: ToolCallInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function providerWriteIdempotencyInput(
  block: ToolUseBlock,
  input: ToolCallInput,
  scopeId: string,
): ProviderWriteIdempotencyInput | null {
  const explicitKey = stringInput(input, "idempotencyKey");
  if (explicitKey === undefined) return null;
  const effect = getToolEffect(block.name);
  if (!effect || effect.kind === "read") return null;
  const projection = { ...(input as IdempotencyJsonObject) };
  delete projection.idempotencyKey;
  return {
    scopeId,
    key: `tool:${hashIdempotencyMaterial([block.name, explicitKey])}`,
    parameterFingerprint: fingerprintIdempotencyParams({
      tool: block.name,
      input: projection,
    }),
  };
}

export function toolResultProjection(
  block: ToolUseBlock,
  result: ToolResult,
): IdempotencyJsonObject {
  return {
    kind: "provider-write",
    tool: block.name,
    toolUseId: block.id,
    content: result.content,
    isError: result.is_error === true,
    completedAt: new Date().toISOString(),
  };
}

export function toolResultFromProjection(
  projection: IdempotencyJsonObject,
  fallbackTool: string,
): ToolResult {
  const content = typeof projection.content === "string"
    ? projection.content
    : `Replayed idempotent result for ${fallbackTool}`;
  return {
    content,
    ...(projection.isError === true ? { is_error: true } : {}),
  };
}

export function idempotencyMeta(status: string, key: string): KotaJsonObject {
  return { idempotency: { status, key } };
}

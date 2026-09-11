
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type { StoreScopeContext } from "#modules/store-scope-context.js";
import type {
  RetractRequest,
  RetractResult,
  RetractTarget,
} from "./client.js";

export type {
  RetractInboxResult,
  RetractKnowledgeResult,
  RetractMemoryResult,
  RetractRequest,
  RetractResult,
  RetractTarget,
  RetractTasksResult,
} from "./client.js";

export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export type RetractScopeContext = StoreScopeContext;

export interface RetractProvider {
  retract(
    request: RetractRequest,
    scope?: RetractScopeContext,
  ): Promise<RetractResult>;
}

export const RETRACT_PROVIDER_TOKEN: ProviderToken<RetractProvider> =
  defineProviderToken<RetractProvider>("retract");


import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type { StoreScopeContext } from "#modules/store-scope-context.js";
import type {
  CaptureFilter,
  CaptureResult,
  CaptureTarget,
} from "./client.js";

export type {
  CaptureFilter,
  CaptureInboxResult,
  CaptureKnowledgeResult,
  CaptureMemoryResult,
  CaptureResult,
  CaptureTarget,
  CaptureTasksResult,
} from "./client.js";

export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export type CaptureScopeContext = StoreScopeContext;

export interface CaptureClassifier {
  classify(input: {
    text: string;
    hint?: string;
    available: ReadonlyArray<CaptureTarget>;
  }): Promise<CaptureClassification>;
}

export type CaptureClassification =
  | { kind: "confident"; target: CaptureTarget }
  | { kind: "ambiguous" };

export interface CaptureProvider {
  capture(
    text: string,
    filter?: CaptureFilter,
    scope?: CaptureScopeContext,
  ): Promise<CaptureResult>;
}

export const CAPTURE_PROVIDER_TOKEN: ProviderToken<CaptureProvider> =
  defineProviderToken<CaptureProvider>("capture");

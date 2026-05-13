/**
 * Capture seam — typed protocol for cross-store write fan-out.
 *
 * `CaptureContributor` is what each store implements. A contributor takes
 * a natural-language note and returns either the typed identifier its
 * store minted or an explicit thrown error. The seam never silently
 * swallows a thrown contributor — the result surfaces as a typed
 * `contributor_failed` arm.
 *
 * `CaptureProvider` is the seam consumers see. It does not know the set
 * of contributors at type-time — `register` accepts N typed contributors,
 * so adding a fifth store is a registration, not an enum edit.
 */

import type { ProjectId } from "#core/daemon/project-registry.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type {
  KnowledgeProvider,
  MemoryProvider,
} from "#core/modules/provider-types.js";
import type {
  CaptureFilter,
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
} from "./client.js";

export type {
  CaptureFilter,
  CaptureInboxRecord,
  CaptureKnowledgeRecord,
  CaptureMemoryRecord,
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
  CaptureTasksRecord,
} from "./client.js";

/**
 * Stable contributor ordering used by the seam to render `suggestions`
 * deterministically and to drive the classifier's prompt. Adding a new
 * contributor extends `CaptureTarget` and the discriminated `CaptureRecord`
 * union; it does not require editing this constant unless the operator
 * wants the new contributor's order to differ from the alphabetical default.
 */
export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export type CaptureProjectContext = {
  projectId: ProjectId;
  projectDir: string;
  memory: MemoryProvider;
  knowledge: KnowledgeProvider;
};

/**
 * Input every contributor sees. The seam does not pre-process the text
 * beyond trimming the leading and trailing whitespace; classification
 * (when it runs) consumes the same trimmed text.
 */
export type CaptureContributorInput = {
  text: string;
  hint?: string;
  project?: CaptureProjectContext;
};

/**
 * One contributor for the capture seam. The contributor owns its own
 * write — the seam never reaches around it into the store's filesystem
 * or in-memory layout. A contributor that cannot complete its write
 * throws; the seam catches the throw and surfaces `contributor_failed`.
 */
export interface CaptureContributor {
  readonly target: CaptureTarget;
  capture(input: CaptureContributorInput): Promise<CaptureRecord>;
}

/**
 * Pluggable classifier the seam consults when no `target` is given.
 * Returns a single `CaptureTarget` plus a confidence band. The seam
 * promotes a high-confidence pick to a successful capture and surfaces
 * a low-confidence (or absent) result as `ambiguous`.
 *
 * `available` is the contributor set the classifier may pick from; the
 * classifier must never return a target outside the supplied list.
 */
export interface CaptureClassifier {
  classify(input: {
    text: string;
    hint?: string;
    available: ReadonlyArray<CaptureTarget>;
  }): Promise<CaptureClassification>;
}

/**
 * Classifier output. `ambiguous` is the explicit unknown — the seam
 * surfaces it as `{ ok: false, reason: "ambiguous" }` without trying a
 * second classification pass.
 */
export type CaptureClassification =
  | { kind: "confident"; target: CaptureTarget }
  | { kind: "ambiguous" };

/** The owning provider seam. */
export interface CaptureProvider {
  register(contributor: CaptureContributor): void;
  /** List currently-registered contributor targets, in registration order. */
  contributors(): ReadonlyArray<CaptureTarget>;
  capture(
    text: string,
    filter?: CaptureFilter,
    project?: CaptureProjectContext,
  ): Promise<CaptureResult>;
}

/** Provider-registry token for the cross-store capture seam. */
export const CAPTURE_PROVIDER_TOKEN: ProviderToken<CaptureProvider> =
  defineProviderToken<CaptureProvider>("capture");

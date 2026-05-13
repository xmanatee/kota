/**
 * Retract seam — typed protocol for cross-store removal.
 *
 * `RetractContributor` is what each store implements. A contributor takes
 * its target's strict identifier shape and removes the matching record;
 * it must distinguish "the record was not present" from "removal failed
 * mid-flight" so the seam can surface those two as separate envelope arms.
 *
 * `RetractProvider` is the seam consumers see. Like the capture seam, it
 * does not know the set of contributors at type-time — `register` accepts
 * N typed contributors so adding a fifth store is a registration, not an
 * enum edit.
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
  RetractRecord,
  RetractRequest,
  RetractResult,
  RetractTarget,
} from "./client.js";

export type {
  RetractInboxRecord,
  RetractKnowledgeRecord,
  RetractMemoryRecord,
  RetractRecord,
  RetractRequest,
  RetractResult,
  RetractTarget,
  RetractTasksRecord,
} from "./client.js";

/**
 * Stable contributor ordering used by render/test surfaces. Adding a new
 * contributor extends `RetractTarget` and the discriminated `RetractRecord`
 * union; it does not require editing this constant unless the operator
 * wants the new contributor's order to differ from the alphabetical default.
 */
export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export type RetractProjectContext = {
  projectId: ProjectId;
  projectDir: string;
  memory: MemoryProvider;
  knowledge: KnowledgeProvider;
};

/**
 * Result a contributor returns. The seam translates these arms into the
 * outer `RetractResult` envelope.
 */
export type RetractContributorResult =
  | { kind: "removed"; record: RetractRecord }
  | { kind: "not_found"; identifier: string };

/**
 * One contributor for the retract seam. Each contributor consumes only
 * the per-target arm of `RetractRequest` so the type system rejects a
 * memory `id` being passed to the knowledge contributor at compile time.
 *
 * A contributor that cannot complete its removal throws; the seam catches
 * the throw and surfaces `contributor_failed`. A contributor that finds
 * no matching record returns the `not_found` result so the seam can surface
 * the typed `not_found` arm without raising — consistent with the capture
 * seam never silently retrying into a different store.
 */
export type MemoryRetractContributor = {
  readonly target: "memory";
  retract(req: { id: string; project?: RetractProjectContext }): Promise<RetractContributorResult>;
};

export type KnowledgeRetractContributor = {
  readonly target: "knowledge";
  retract(req: { slug: string; project?: RetractProjectContext }): Promise<RetractContributorResult>;
};

export type TasksRetractContributor = {
  readonly target: "tasks";
  retract(req: { id: string; project?: RetractProjectContext }): Promise<RetractContributorResult>;
};

export type InboxRetractContributor = {
  readonly target: "inbox";
  retract(req: { path: string; project?: RetractProjectContext }): Promise<RetractContributorResult>;
};

export type RetractContributor =
  | MemoryRetractContributor
  | KnowledgeRetractContributor
  | TasksRetractContributor
  | InboxRetractContributor;

/** The owning provider seam. */
export interface RetractProvider {
  register(contributor: RetractContributor): void;
  /** List currently-registered contributor targets, in registration order. */
  contributors(): ReadonlyArray<RetractTarget>;
  retract(
    request: RetractRequest,
    project?: RetractProjectContext,
  ): Promise<RetractResult>;
}

/** Provider-registry token for the cross-store retract seam. */
export const RETRACT_PROVIDER_TOKEN: ProviderToken<RetractProvider> =
  defineProviderToken<RetractProvider>("retract");

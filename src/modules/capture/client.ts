/**
 * Capture namespace client contract.
 *
 * The capture module owns its KotaClient namespace surface end-to-end:
 * this file declares the filter/record/result types and the `CaptureClient`
 * interface that the `KotaClient` aggregate composes. Both the local-side
 * handler (`localClient(ctx)` in `index.ts`) and the daemon-side handler
 * (`daemonClient(link)` in `index.ts`) realize this contract; the
 * `kota capture` CLI, the `capture` agent tool, the route handler, the
 * contributors, the system-prompt provider, and the public HTTP server all
 * consume it through `ctx.client.capture` or by importing these types from
 * `#modules/capture/client.js`.
 */

/**
 * Target store for a `CaptureClient.capture` call. Mirrors the contributor
 * sources registered by the capture seam. Adding a fifth contributor
 * extends this union and the `CaptureRecord` discriminated type below.
 */
export type CaptureTarget = "memory" | "knowledge" | "tasks" | "inbox";

/** Memory-store record minted by a successful capture. */
export type CaptureMemoryRecord = {
  target: "memory";
  recordId: string;
};

/** Knowledge-store record minted by a successful capture. */
export type CaptureKnowledgeRecord = {
  target: "knowledge";
  recordId: string;
};

/** Tasks-store record minted by a successful capture. */
export type CaptureTasksRecord = {
  target: "tasks";
  recordId: string;
  path: string;
};

/** Inbox-store record minted by a successful capture. */
export type CaptureInboxRecord = {
  target: "inbox";
  recordId: string;
  path: string;
};

/**
 * Discriminated record returned on a successful capture. `recordId` is
 * the typed identifier each store already exposes (memory id, knowledge
 * slug, task id, inbox file slug); per-target arms also expose any
 * additional path metadata so a caller can resolve back to the
 * underlying store the same way recall hits do.
 */
export type CaptureRecord =
  | CaptureMemoryRecord
  | CaptureKnowledgeRecord
  | CaptureTasksRecord
  | CaptureInboxRecord;

/**
 * Filter accepted by `CaptureClient.capture`.
 *
 * - `target` pins the destination contributor; the seam dispatches
 *   verbatim and skips classification.
 * - `hint` is a free-form string the classifier may consume when no
 *   `target` is supplied. The seam never tries to be clever with it
 *   beyond passing it to the classifier prompt.
 */
export type CaptureFilter = {
  target?: CaptureTarget;
  hint?: string;
  projectId?: string;
};

/**
 * Result of `capture.capture`.
 *
 * The seam deliberately returns one strict envelope:
 *
 * - `ok: true` → the contributor accepted the write. The record carries
 *   the typed identifier the underlying store minted plus any per-target
 *   metadata.
 * - `ok: false, reason: "ambiguous"` → no `target` was given and the
 *   classifier could not pick a single destination confidently. The
 *   surface (or upstream caller) disambiguates by re-issuing the call
 *   with an explicit `target`. `suggestions` is the contributor list
 *   the classifier considered.
 * - `ok: false, reason: "no_contributors"` → the seam has no
 *   registered contributors. Mirrors recall's `semantic_unavailable`
 *   shape so callers can branch on "the seam is unconfigured".
 * - `ok: false, reason: "contributor_failed"` → the chosen contributor
 *   threw (e.g. inbox writer cannot reach the project root). The seam
 *   never silently retries into a different store.
 */
export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | {
      ok: false;
      reason: "ambiguous";
      suggestions: ReadonlyArray<CaptureTarget>;
    }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "contributor_failed";
      target: CaptureTarget;
      message: string;
    };

/**
 * Cross-store capture operations.
 *
 * `capture(text, filter?)` writes one natural-language note to the
 * right store. When `filter.target` is set, the seam dispatches verbatim
 * to that contributor. When no target is given, an internal classifier
 * picks one or surfaces the ambiguous envelope so the caller can
 * disambiguate. The seam delegates writes to each store's existing
 * in-process writer — it never opens a parallel persistence path.
 */
export interface CaptureClient {
  capture(text: string, filter?: CaptureFilter): Promise<CaptureResult>;
}

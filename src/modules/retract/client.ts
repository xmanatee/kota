/**
 * Retract namespace client contract.
 *
 * The retract module owns its KotaClient namespace surface end-to-end:
 * this file declares the request/response/record types and the
 * `RetractClient` interface that the `KotaClient` aggregate composes. Both
 * the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota retract` CLI, the `retract` agent tool, the route
 * handler, the contributors, the system-prompt provider, and the external
 * channel modules (Slack, Telegram) all consume it through
 * `ctx.client.retract` or by importing these types from
 * `#modules/retract/client.js`.
 */

/**
 * Target store for a `RetractClient.retract` call. Mirrors the contributor
 * sources registered by the retract seam. Adding a fifth contributor
 * extends this union and the `RetractRecord` discriminated type below.
 */
export type RetractTarget = "memory" | "knowledge" | "tasks" | "inbox";

/** Memory-store record removed by a successful retract. */
export type RetractMemoryRecord = {
  target: "memory";
  recordId: string;
};

/** Knowledge-store record removed by a successful retract. */
export type RetractKnowledgeRecord = {
  target: "knowledge";
  recordId: string;
};

/**
 * Tasks-store record dropped by a successful retract.
 *
 * Retracting a task does not delete the file — it routes through the
 * existing task-state machine into `data/tasks/dropped/`. The arm carries
 * the previous and resulting paths plus the explicit destination state so
 * the operator surface can render "moved to dropped", not "deleted".
 */
export type RetractTasksRecord = {
  target: "tasks";
  recordId: string;
  /** Previous repo-relative path (`data/tasks/<state>/<id>.md`). */
  previousPath: string;
  /** New repo-relative path (always under `data/tasks/dropped/`). */
  path: string;
  /** Resulting task state — always `"dropped"` for the retract seam. */
  toState: "dropped";
};

/** Inbox-store record removed by a successful retract. */
export type RetractInboxRecord = {
  target: "inbox";
  recordId: string;
  /** Repo-relative path of the deleted note file. */
  path: string;
};

/**
 * Discriminated record returned on a successful retract. Mirrors
 * `CaptureRecord`; per-target arms carry whatever metadata the operator
 * surface needs to render "what just happened" without leaking internal
 * filesystem moves into the seam.
 */
export type RetractRecord =
  | RetractMemoryRecord
  | RetractKnowledgeRecord
  | RetractTasksRecord
  | RetractInboxRecord;

/**
 * Request shape every retract call produces.
 *
 * The seam deliberately models per-target identifier shapes as distinct
 * fields so caller code cannot pass a `slug` to the memory contributor
 * or an `id` to the knowledge contributor by accident. Every call names
 * its target explicitly — there is no implicit cross-target search.
 *
 * - `target: "memory"` — `id` is the memory id.
 * - `target: "knowledge"` — `slug` is the knowledge slug/id.
 * - `target: "tasks"` — `id` is the task id (filename without `.md`).
 * - `target: "inbox"` — `path` is the repo-relative inbox file path
 *   (e.g. `data/inbox/note-foo.md`).
 */
export type RetractRequest =
  | { target: "memory"; id: string; projectId?: string }
  | { target: "knowledge"; slug: string; projectId?: string }
  | { target: "tasks"; id: string; projectId?: string }
  | { target: "inbox"; path: string; projectId?: string };

/**
 * Result of `retract.retract`.
 *
 * - `ok: true` → the contributor accepted the removal. The record carries
 *   the typed identifier(s) that were actually removed plus any path
 *   metadata the operator needs ("moved to dropped" / "file deleted").
 * - `ok: false, reason: "no_contributors"` → the seam itself is
 *   unconfigured (zero contributors registered, or the explicit `target`
 *   is not registered).
 * - `ok: false, reason: "not_found"` → the named record is not present
 *   in the named target. The seam never falls back into a different
 *   store.
 * - `ok: false, reason: "contributor_failed"` → the chosen contributor
 *   threw mid-removal. The seam never silently retries into a different
 *   store.
 */
export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "not_found";
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: "contributor_failed";
      target: RetractTarget;
      message: string;
    };

/**
 * Cross-store retract operations.
 *
 * `retract(request)` removes one named record from one named target,
 * routing through the same in-process retract provider every other
 * surface (CLI, agent tool, daemon route) consumes. The seam delegates
 * to each store's existing removal helper (`MemoryProvider.delete`,
 * `KnowledgeProvider.delete`, `moveTaskById(... "dropped")`, an inbox
 * `unlinkSync`) — it never opens a parallel persistence path and never
 * tries to be clever across targets.
 */
export interface RetractClient {
  retract(request: RetractRequest): Promise<RetractResult>;
}

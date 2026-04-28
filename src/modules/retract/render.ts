/**
 * Plain-text rendering of retract envelopes.
 *
 * One block per result:
 *
 * - On success, render the target plus the typed identifier (and path
 *   metadata when the contributor moved or unlinked a file).
 * - On the no-contributors arm, render a single "unconfigured" line.
 * - On the not-found arm, name the target and the identifier so the
 *   operator can recognize the typo or stale id.
 * - On the contributor-failed arm, render the target and the error
 *   message verbatim.
 *
 * The CLI, the daemon route, the chat-surface (when one ships), and the
 * agent-tool runner all consume this single helper so the seam cannot
 * drift between surfaces.
 */
import type {
  RetractRecord,
  RetractResult,
} from "#core/server/kota-client.js";

export function renderRetractRecordPlain(record: RetractRecord): string {
  switch (record.target) {
    case "memory":
      return `memory  ${record.recordId}`;
    case "knowledge":
      return `knowledge  ${record.recordId}`;
    case "tasks":
      return `tasks  ${record.recordId}  ${record.previousPath} -> ${record.path} (${record.toState})`;
    case "inbox":
      return `inbox  ${record.recordId}  ${record.path}`;
  }
}

export function renderRetractResultPlain(result: RetractResult): string {
  if (result.ok) {
    return `Retracted: ${renderRetractRecordPlain(result.record)}`;
  }
  switch (result.reason) {
    case "no_contributors":
      return "Cross-store retract has no registered contributors for the named target.";
    case "not_found":
      return `Retract ${result.target}: no record with identifier "${result.identifier}".`;
    case "contributor_failed":
      return `Retract from ${result.target} failed: ${result.message}`;
  }
}

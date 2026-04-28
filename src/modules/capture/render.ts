/**
 * Plain-text rendering of capture envelopes.
 *
 * One block per result:
 *
 * - On success, render the target plus the typed identifier (and path
 *   when the target is a filesystem-backed contributor).
 * - On the ambiguous arm, list the suggestions the seam considered so
 *   the operator can re-issue with `--target`.
 * - On the no-contributors arm, render a single "unconfigured" line.
 * - On the contributor-failed arm, render the target and the error
 *   message verbatim.
 */
import type { CaptureRecord, CaptureResult } from "#core/server/kota-client.js";

export function renderCaptureRecordPlain(record: CaptureRecord): string {
  switch (record.target) {
    case "memory":
      return `memory  ${record.recordId}`;
    case "knowledge":
      return `knowledge  ${record.recordId}`;
    case "tasks":
      return `tasks  ${record.recordId}  ${record.path}`;
    case "inbox":
      return `inbox  ${record.recordId}  ${record.path}`;
  }
}

export function renderCaptureResultPlain(result: CaptureResult): string {
  if (result.ok) {
    return `Captured: ${renderCaptureRecordPlain(result.record)}`;
  }
  switch (result.reason) {
    case "ambiguous":
      return `Ambiguous capture. Re-run with --target <one of: ${result.suggestions.join(", ")}>.`;
    case "no_contributors":
      return "Cross-store capture has no registered contributors.";
    case "contributor_failed":
      return `Capture into ${result.target} failed: ${result.message}`;
  }
}

import type {
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
} from './types';

/**
 * Per-target tint mapping for the capture badges in `CaptureScreen`.
 * Mirrors the same per-store color vocabulary the recall/answer surfaces
 * already speak: `knowledge`→blue, `memory`→purple, `tasks`→orange, plus
 * a green inbox tint for the inbox contributor (which does not appear in
 * `RECALL_SOURCE_TINT`). Centralizing the table avoids drifting between
 * the success row, the suggestion chips on the ambiguous arm, and the
 * contributor-failed badge.
 */
export const CAPTURE_TARGET_TINT: Record<
  CaptureTarget,
  { bg: string; fg: string }
> = {
  knowledge: { bg: 'rgba(0, 122, 255, 0.15)', fg: '#0a5fc2' },
  memory: { bg: 'rgba(175, 82, 222, 0.15)', fg: '#7d3fb0' },
  tasks: { bg: 'rgba(255, 149, 0, 0.18)', fg: '#a85a00' },
  inbox: { bg: 'rgba(52, 199, 89, 0.18)', fg: '#1f7a3a' },
};

/**
 * Mirror of `renderCaptureRecordPlain` exported from
 * `src/modules/capture/render.ts:25-36`: `<target>  <recordId>` for
 * memory/knowledge and `<target>  <recordId>  <path>` for tasks/inbox.
 */
export function renderCaptureRecordPlain(record: CaptureRecord): string {
  switch (record.target) {
    case 'memory':
      return `memory  ${record.recordId}`;
    case 'knowledge':
      return `knowledge  ${record.recordId}`;
    case 'tasks':
      return `tasks  ${record.recordId}  ${record.path}`;
    case 'inbox':
      return `inbox  ${record.recordId}  ${record.path}`;
  }
}

/**
 * Mirror of `renderCaptureResultPlain` exported from
 * `src/modules/capture/render.ts:38-50`. Sharing the line shape keeps
 * the mobile body identical to the `kota capture` CLI, the daemon HTTP
 * route, the embedded web `CapturePanel` body, and the macOS
 * `renderCaptureResultPlain` line shape — six operator surfaces, one
 * rendered line shape. The chat-surface variant
 * (`renderCaptureReplyPlain`) is Telegram-specific and intentionally
 * not mirrored here.
 */
export function renderCaptureResultPlain(result: CaptureResult): string {
  if (result.ok) {
    return `Captured: ${renderCaptureRecordPlain(result.record)}`;
  }
  switch (result.reason) {
    case 'ambiguous':
      return `Ambiguous capture. Re-run with --target <one of: ${result.suggestions.join(', ')}>.`;
    case 'no_contributors':
      return 'Cross-store capture has no registered contributors.';
    case 'contributor_failed':
      return `Capture into ${result.target} failed: ${result.message}`;
  }
}

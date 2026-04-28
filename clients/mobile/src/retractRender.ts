import type {
  RetractRecord,
  RetractResult,
  RetractTarget,
} from './types';

/**
 * Per-target tint mapping for the retract badges in `RetractScreen`.
 * Mirrors `CAPTURE_TARGET_TINT` exactly so a record removed by retract
 * carries the same per-store color the matching capture would: knowledge
 * blue, memory purple, tasks orange, inbox green. One tint vocabulary
 * across capture and retract; no third palette.
 */
export const RETRACT_TARGET_TINT: Record<
  RetractTarget,
  { bg: string; fg: string }
> = {
  knowledge: { bg: 'rgba(0, 122, 255, 0.15)', fg: '#0a5fc2' },
  memory: { bg: 'rgba(175, 82, 222, 0.15)', fg: '#7d3fb0' },
  tasks: { bg: 'rgba(255, 149, 0, 0.18)', fg: '#a85a00' },
  inbox: { bg: 'rgba(52, 199, 89, 0.18)', fg: '#1f7a3a' },
};

/**
 * Mirror of `renderRetractRecordPlain` exported from
 * `src/modules/retract/render.ts:23-34`: `<target>  <recordId>` for
 * memory/knowledge, `<target>  <recordId>  <previousPath> -> <path> (<toState>)`
 * for tasks (the file move is the visible event), and
 * `<target>  <recordId>  <path>` for inbox (the deletion path).
 */
export function renderRetractRecordPlain(record: RetractRecord): string {
  switch (record.target) {
    case 'memory':
      return `memory  ${record.recordId}`;
    case 'knowledge':
      return `knowledge  ${record.recordId}`;
    case 'tasks':
      return `tasks  ${record.recordId}  ${record.previousPath} -> ${record.path} (${record.toState})`;
    case 'inbox':
      return `inbox  ${record.recordId}  ${record.path}`;
  }
}

/**
 * Mirror of `renderRetractResultPlain` exported from
 * `src/modules/retract/render.ts:36-48`. Sharing the line shape keeps
 * the mobile body identical to the `kota retract` CLI, the daemon HTTP
 * route, the embedded web `RetractPanel` body, and the macOS
 * `renderRetractResultPlain` line shape — five operator surfaces, one
 * rendered line shape.
 */
export function renderRetractResultPlain(result: RetractResult): string {
  if (result.ok) {
    return `Retracted: ${renderRetractRecordPlain(result.record)}`;
  }
  switch (result.reason) {
    case 'no_contributors':
      return 'Cross-store retract has no registered contributors for the named target.';
    case 'not_found':
      return `Retract ${result.target}: no record with identifier "${result.identifier}".`;
    case 'contributor_failed':
      return `Retract from ${result.target} failed: ${result.message}`;
  }
}

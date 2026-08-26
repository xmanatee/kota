import type {
  UiLogEntry,
  UiNode,
  UiSurfaceBundle,
} from '../daemon/ui-surface.generated';
import type { SseEvent } from '../daemon/sse';

export type UiEventMatch = {
  refresh: boolean;
  streamIds: readonly string[];
};

export function matchUiEvent(
  bundle: UiSurfaceBundle | null,
  event: Pick<SseEvent, 'type' | 'payload'>,
): UiEventMatch {
  if (!bundle) {
    return { refresh: false, streamIds: [] };
  }
  let refresh = false;
  const streamIds = new Set<string>();
  for (const surface of bundle.surfaces) {
    if (!eventBelongsToScope(surface.scopeId, event.payload)) continue;
    if (surface.refreshEvents?.includes(event.type)) refresh = true;
    const before = streamIds.size;
    collectStreamIds(surface.nodes, event.type, streamIds);
    if (streamIds.size > before) refresh = true;
  }
  return { refresh, streamIds: [...streamIds].sort() };
}

function eventBelongsToScope(
  scopeId: string,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  const selector =
    typeof payload.scopeId === 'string'
      ? payload.scopeId
      : typeof payload.scopeId === 'string'
        ? payload.scopeId
        : undefined;
  return selector === undefined || selector === scopeId;
}

export function uiLogEntry(event: SseEvent): UiLogEntry {
  return {
    timestamp: event.timestamp ?? new Date().toISOString(),
    level: uiLogLevel(event.payload.level),
    source: event.type,
    message:
      typeof event.payload.message === 'string'
        ? event.payload.message
        : eventPayloadSummary(event.payload),
  };
}

function collectStreamIds(
  nodes: readonly UiNode[],
  eventType: string,
  streamIds: Set<string>,
): void {
  for (const node of nodes) {
    if (node.kind === 'tabs') {
      for (const tab of node.tabs) {
        collectStreamIds(tab.nodes, eventType, streamIds);
      }
    } else if (
      node.kind === 'log-stream' &&
      node.source.eventTypes.includes(eventType)
    ) {
      streamIds.add(node.streamId);
    }
  }
}

function uiLogLevel(value: unknown): UiLogEntry['level'] {
  return value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
    ? value
    : 'info';
}

function eventPayloadSummary(payload: Record<string, unknown>): string {
  const fields = Object.entries(payload)
    .filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    )
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`);
  return fields.length > 0 ? fields.join(' · ') : 'Event received.';
}

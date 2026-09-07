import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import {
  orderedIntents,
  resolveDeepLink,
  surfacesForIntent,
} from '../shared-ui/graph';
import { matchUiEvent, uiLogEntry } from '../shared-ui/live-events';

const bundle = parseUiSurfaceBundle(fixture.operatorBundle);

describe('Android shared UI graph', () => {
  test('orders native intent tabs and their surface stack independently', () => {
    const template = bundle.surfaces[0]!;
    const surfaces = [
      { ...template, surfaceId: 'later', title: 'Later', intent: 'Work' as const, order: 20 },
      { ...template, surfaceId: 'status', title: 'Status', intent: 'Status' as const, order: 10 },
      { ...template, surfaceId: 'first', title: 'First', intent: 'Work' as const, order: 5 },
    ];
    const navigationBundle = { ...bundle, surfaces };
    expect(orderedIntents(navigationBundle)).toEqual(['Work', 'Status']);
    expect(surfacesForIntent(navigationBundle, 'Work').map((surface) => surface.surfaceId))
      .toEqual(['first', 'later']);
  });

  test('rejects deep links to missing surfaces or actions', () => {
    expect(resolveDeepLink(bundle, { surfaceId: 'missing' })).toBeNull();
    expect(
      resolveDeepLink(bundle, { surfaceId: bundle.surfaces[0]!.surfaceId, actionId: 'missing' }),
    ).toBeNull();
  });

  test('matches graph-declared refresh events and appends typed live logs', () => {
    const eventType = bundle.surfaces
      .flatMap((surface) => surface.nodes)
      .find((node) => node.kind === 'log-stream' && node.source.eventTypes.length > 0);
    expect(eventType?.kind).toBe('log-stream');
    if (!eventType || eventType.kind !== 'log-stream') return;
    const match = matchUiEvent(bundle, {
      type: eventType.source.eventTypes[0]!,
      payload: { scopeId: bundle.surfaces[0]!.scopeId },
    });
    expect(match.refresh).toBe(true);
    expect(match.streamIds).toContain(eventType.streamId);
    expect(
      matchUiEvent(bundle, {
        type: eventType.source.eventTypes[0]!,
        payload: { scopeId: 'another-scope' },
      }),
    ).toEqual({ refresh: false, streamIds: [] });
    expect(
      uiLogEntry({
        type: eventType.source.eventTypes[0]!,
        timestamp: '2026-08-23T16:00:00.000Z',
        payload: { level: 'warn', message: 'Live refresh received.' },
      }),
    ).toMatchObject({
      level: 'warn',
      message: 'Live refresh received.',
    });
  });
});

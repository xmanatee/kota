import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import {
  orderedIntents,
  resolveDeepLink,
  surfaceActionIds,
  surfacesForIntent,
} from '../shared-ui/graph';
import { matchUiEvent, uiLogEntry } from '../shared-ui/live-events';

const bundle = parseUiSurfaceBundle(fixture.operatorBundle);

describe('Android shared UI graph', () => {
  test('derives every intent tab and surface stack from ordered graph data', () => {
    const expectedIntents = [...bundle.surfaces]
      .sort((left, right) => left.order - right.order)
      .reduce<typeof bundle.surfaces[number]['intent'][]>((items, surface) => {
        if (!items.includes(surface.intent)) items.push(surface.intent);
        return items;
      }, []);
    expect(orderedIntents(bundle)).toEqual(expectedIntents);

    const stackedSurfaceIds = orderedIntents(bundle).flatMap((intent) =>
      surfacesForIntent(bundle, intent).map((surface) => surface.surfaceId),
    );
    expect(stackedSurfaceIds).toHaveLength(bundle.surfaces.length);
    expect(new Set(stackedSurfaceIds)).toEqual(
      new Set(bundle.surfaces.map((surface) => surface.surfaceId)),
    );
  });

  test('resolves stable surface and action deep links against the live bundle', () => {
    for (const surface of bundle.surfaces) {
      expect(resolveDeepLink(bundle, { surfaceId: surface.surfaceId })?.surface)
        .toBe(surface);
      for (const actionId of surfaceActionIds(surface)) {
        expect(
          resolveDeepLink(bundle, { surfaceId: surface.surfaceId, actionId }),
        ).toMatchObject({ surface, actionId });
      }
    }
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

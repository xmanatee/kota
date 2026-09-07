import React from 'react';
import { RefreshControl } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import { SharedUiSurface } from '../shared-ui/SharedUiSurface';

const mockExecuteUiAction = jest.fn(async () => ({
  ok: true as const,
  message: 'Action completed.',
}));

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => ({ executeUiAction: mockExecuteUiAction }),
}));

const bundle = parseUiSurfaceBundle(fixture.operatorBundle);
const surface = bundle.surfaces.find(
  (candidate) => candidate.surfaceId === 'operator-control',
)!;

describe('Android shared UI surface renderer', () => {
  beforeEach(() => mockExecuteUiAction.mockClear());

  test('renders native readiness and live log content', () => {
    const view = renderSurface();
    expect(view.getByText('Operator Control')).toBeTruthy();
    expect(view.getByText('Live daemon events')).toBeTruthy();
    expect(view.getByText('Live mobile event appended.')).toBeTruthy();
    expect(view.getByText('Action unavailable')).toBeTruthy();
    expect(view.getByLabelText('Configure launch defaults')).toBeDisabled();
  });

  test('routes native navigation, daemon links, and pull-to-refresh callbacks', () => {
    const onNavigate = jest.fn();
    const onOpenLink = jest.fn();
    const onRefresh = jest.fn();
    const view = renderSurface({ onNavigate, onOpenLink, onRefresh });

    fireEvent.press(view.getByLabelText('Status'));
    expect(onNavigate).toHaveBeenCalledWith('status');
    fireEvent.press(view.getByLabelText('Open shared UI surface route'));
    expect(onOpenLink).toHaveBeenCalledWith({
      kind: 'daemon-route',
      path: '/ui/surfaces',
    });

    fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

function renderSurface(overrides: {
  onNavigate?: jest.Mock;
  onOpenLink?: jest.Mock;
  onRefresh?: jest.Mock;
  surface?: typeof surface;
} = {}) {
  return render(
    <SharedUiSurface
      surface={overrides.surface ?? surface}
      onNavigate={overrides.onNavigate ?? jest.fn()}
      onOpenLink={overrides.onOpenLink ?? jest.fn()}
      onRefresh={overrides.onRefresh ?? jest.fn()}
      refreshing={false}
      onOpenConnection={jest.fn()}
      liveLogEntries={{
        'daemon-events': [
          {
            timestamp: '2026-08-23T16:00:00.000Z',
            level: 'info',
            source: 'workflow.run.completed',
            message: 'Live mobile event appended.',
          },
        ],
      }}
    />,
  );
}

import React from 'react';
import {
  RefreshControl,
} from 'react-native';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import {
  parseUiSurfaceBundle,
  type UiNode,
} from '../daemon/ui-surface.generated';
import { writeBuilderEvidence } from './builderEvidence';
import { SharedUiNode } from '../shared-ui/SharedUiNode';
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

  test('renders the canonical composite surface with native components', () => {
    const view = renderSurface();
    const nodeKinds = new Set(surface.nodes.map((node) => node.kind));
    const missingKinds = [...nodeKinds].filter(
      (kind) => view.queryAllByTestId(`ui-node-${kind}`).length === 0,
    );
    expect(missingKinds).toEqual([]);
    expect(view.getByText('Operator Control')).toBeTruthy();
    expect(view.getByText('Live daemon events')).toBeTruthy();
    expect(view.getByText('Action unavailable')).toBeTruthy();
    expect(view.getByLabelText('Configure launch defaults')).toBeDisabled();

    writeBuilderEvidence('android-rendered-native-tree.json', {
      protocolVersion: bundle.protocolVersion,
      platform: 'android-react-native',
      sourceBundle:
        'scripts/ui-behavior-vectors.mjs#operatorBundle',
      surfaceId: surface.surfaceId,
      nodeKinds: [...nodeKinds].sort(),
      tree: view.toJSON(),
    });
  });

  test('renders every generated node arm contributed by the canonical fixture', () => {
    const nodesByKind = new Map<UiNode['kind'], UiNode>();
    for (const candidate of bundle.surfaces) {
      for (const node of collectNodes(candidate.nodes)) {
        nodesByKind.set(node.kind, node);
      }
    }

    const renderedKinds = new Set<UiNode['kind']>();
    for (const [kind, node] of nodesByKind) {
      const view = render(
        <SharedUiNode
          node={node}
          onNavigate={jest.fn()}
          onOpenLink={jest.fn()}
        />,
      );
      expect(view.getByTestId(`ui-node-${kind}`)).toBeTruthy();
      renderedKinds.add(kind);
      view.unmount();
    }
    expect(renderedKinds).toEqual(new Set(nodesByKind.keys()));
  });

  test('covers component callbacks, live logs, and a confirmed typed action', async () => {
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

    fireEvent.press(view.getByLabelText('Launch workflow run'));
    expect(view.getByText('This can start a new autonomous run in the selected scope.')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Launch run'));
    });
    await waitFor(() => expect(mockExecuteUiAction).toHaveBeenCalledTimes(1));
    expect(mockExecuteUiAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'workflow.launch' }),
      { name: 'builder' },
    );
    expect(view.getByText('Action completed.')).toBeTruthy();

  });

});

function collectNodes(nodes: readonly UiNode[]): UiNode[] {
  const collected: UiNode[] = [];
  for (const node of nodes) {
    collected.push(node);
    if (node.kind === 'tabs') {
      for (const tab of node.tabs) collected.push(...collectNodes(tab.nodes));
    }
  }
  return collected;
}

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

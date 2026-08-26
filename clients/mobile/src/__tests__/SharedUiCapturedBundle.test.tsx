import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import {
  parseUiSurfaceBundle,
  type UiNode,
  type UiSurface,
} from '../daemon/ui-surface.generated';
import { SharedUiSurface } from '../shared-ui/SharedUiSurface';
import { orderedIntents, resolveDeepLink, surfaceActionIds } from '../shared-ui/graph';
import { matchUiEvent } from '../shared-ui/live-events';
import { writeBuilderEvidence } from './builderEvidence';

const mockExecuteUiAction = jest.fn(async () => ({ ok: true as const, message: 'Action completed.' }));
jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => ({ executeUiAction: mockExecuteUiAction }),
}));

const evidenceBundlePath = process.env.KOTA_UI_SURFACE_EVIDENCE_BUNDLE;
const contractBundle = parseUiSurfaceBundle(fixture.operatorBundle);

describe('Android captured shared UI bundle', () => {
  beforeEach(() => mockExecuteUiAction.mockClear());

  (evidenceBundlePath ? test : test.skip)(
    'renders every captured surface and exercises a confirmed typed action',
    async () => {
      const captured = parseUiSurfaceBundle(JSON.parse(readFileSync(evidenceBundlePath!, 'utf8')));
      const renderedSurfaces = captured.surfaces.map((surface) => {
        const view = renderSurface(surface);
        expect(view.getByTestId(`ui-surface-${surface.surfaceId}`)).toBeTruthy();
        const result = {
          surfaceId: surface.surfaceId,
          intent: surface.intent,
          title: surface.title,
          nodeKinds: surface.nodes.map((node) => node.kind),
          actionIds: surface.actions.map((action) => action.actionId),
          tree: view.toJSON(),
        };
        view.unmount();
        return result;
      });
      writeBuilderEvidence('android-captured-bundle-native-trees.json', {
        protocolVersion: captured.protocolVersion,
        platform: 'android-react-native',
        sourceBundle: sourceBundlePath(),
        surfaceCount: captured.surfaces.length,
        renderedSurfaces,
      });

      const runs = captured.surfaces.find((surface) => surface.surfaceId === 'runs')!;
      const launch = runs.actions.find((action) => action.actionId === 'workflow.launch')!;
      if (launch.confirmation.mode !== 'required') throw new Error('Captured launch action lost confirmation.');
      const confirmation = launch.confirmation;
      expect(resolveDeepLink(captured, { surfaceId: runs.surfaceId, actionId: launch.actionId }))
        .toMatchObject({ surface: runs, actionId: launch.actionId });
      const refreshEvent = runs.refreshEvents?.[0];
      expect(matchUiEvent(captured, { type: refreshEvent!, payload: { scopeId: runs.scopeId } }).refresh)
        .toBe(true);

      const interactionView = renderSurface(runs);
      fireEvent.press(interactionView.getByLabelText(launch.label));
      expect(interactionView.getByText(confirmation.detail)).toBeTruthy();
      await act(async () => {
        fireEvent.press(interactionView.getByLabelText(confirmation.confirmLabel));
      });
      await waitFor(() => expect(mockExecuteUiAction).toHaveBeenCalledWith(launch, { name: 'builder' }));
      interactionView.unmount();

      writeBuilderEvidence('android-renderer-parity.json', {
        protocolVersion: captured.protocolVersion,
        sourceBundle: sourceBundlePath(),
        renderer: {
          binding: 'daemon/ui-surface.generated.ts',
          exhaustiveContractNodeKinds: nodeKinds(contractBundle.surfaces),
          capturedNodeKinds: nodeKinds(captured.surfaces),
        },
        graph: {
          intents: orderedIntents(captured),
          surfaceCount: captured.surfaces.length,
          surfaceIds: captured.surfaces.map((surface) => surface.surfaceId),
          actionCount: captured.surfaces.reduce((count, surface) => count + surfaceActionIds(surface).size, 0),
          allCapturedSurfacesRendered: renderedSurfaces.length === captured.surfaces.length,
        },
      });
    },
  );
});

function renderSurface(surface: UiSurface) {
  return render(
    <SharedUiSurface
      surface={surface}
      onNavigate={jest.fn()}
      onOpenLink={jest.fn()}
      onRefresh={jest.fn()}
      refreshing={false}
      onOpenConnection={jest.fn()}
    />,
  );
}

function collectNodes(nodes: readonly UiNode[]): UiNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.kind === 'tabs' ? node.tabs.flatMap((tab) => collectNodes(tab.nodes)) : []),
  ]);
}

function nodeKinds(surfaces: readonly UiSurface[]): string[] {
  return [...new Set(surfaces.flatMap((surface) => collectNodes(surface.nodes).map((node) => node.kind)))].sort();
}

function sourceBundlePath(): string {
  return relative(join(process.cwd(), '..', '..'), evidenceBundlePath!);
}

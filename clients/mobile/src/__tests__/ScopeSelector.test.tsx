import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ScopeSelector } from '../components/ScopeSelector';
import { initialState } from '../context/state';
import type { ClientIdentity } from '../daemon/core';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function makeIdentity(scopes: { scopeId: string; displayName: string }[]): ClientIdentity {
  return {
    scopeName: 'kota',
    scopeRoot: '/tmp/kota',
    daemonVersion: '0.1.0',
    pid: 1,
    startedAt: 't',
    scopeRegistry: {
      rootScopeId: 'global',
      defaultScopeId: scopes[0]!.scopeId,
      scopes: [
        { scopeId: 'global', displayName: 'Global' },
        ...scopes.map((scope) => ({
          scopeId: scope.scopeId,
          directoryRoot: `/tmp/${scope.scopeId}`,
          displayName: scope.displayName,
          parentScopeId: 'global',
        })),
      ],
    },
  };
}

describe('ScopeSelector', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('hides itself when the daemon hosts a single directory scope', () => {
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([{ scopeId: 'p-kota', displayName: 'kota' }]),
        activeScopeId: 'p-kota',
      },
      setActiveScopeId: jest.fn(),
    });
    const { queryByTestId } = render(<ScopeSelector />);
    expect(queryByTestId('scope-selector')).toBeNull();
  });

  test('renders one chip per directory scope and highlights the active one', () => {
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([
          { scopeId: 'p-kota', displayName: 'kota' },
          { scopeId: 'p-side', displayName: 'side-scope' },
        ]),
        activeScopeId: 'p-kota',
      },
      setActiveScopeId: jest.fn(),
    });
    const { getByTestId, getByText } = render(<ScopeSelector />);
    expect(getByTestId('scope-selector')).toBeTruthy();
    expect(getByTestId('scope-selector-chip-p-kota')).toBeTruthy();
    expect(getByTestId('scope-selector-chip-p-side')).toBeTruthy();
    expect(getByText('kota')).toBeTruthy();
    expect(getByText('side-scope')).toBeTruthy();
  });

  test('tapping a chip drives setActiveScopeId with that scope id', () => {
    const setActiveScopeId = jest.fn();
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([
          { scopeId: 'p-kota', displayName: 'kota' },
          { scopeId: 'p-side', displayName: 'side-scope' },
        ]),
        activeScopeId: 'p-kota',
      },
      setActiveScopeId,
    });
    const { getByTestId } = render(<ScopeSelector />);
    fireEvent.press(getByTestId('scope-selector-chip-p-side'));
    expect(setActiveScopeId).toHaveBeenCalledWith('p-side');
  });

  test('hides itself when identity has not resolved yet', () => {
    mockUseDaemon.mockReturnValue({
      state: { ...initialState, identity: null, activeScopeId: null },
      setActiveScopeId: jest.fn(),
    });
    const { queryByTestId } = render(<ScopeSelector />);
    expect(queryByTestId('scope-selector')).toBeNull();
  });

  test('writes the rendered tree to .kota/runs/<run-id>/ as the mobile rendered-evidence artifact', () => {
    const dest =
      process.env.KOTA_RUN_DIR
        ? resolve(process.env.KOTA_RUN_DIR, 'rendered-mobile-scope-selector.json')
        : null;
    if (!dest) return;

    function snapshot(label: string, activeId: string | null): unknown {
      mockUseDaemon.mockReturnValue({
        state: {
          ...initialState,
          identity: makeIdentity([
            { scopeId: 'p-kota', displayName: 'kota' },
            { scopeId: 'p-side', displayName: 'side-scope' },
          ]),
          activeScopeId: activeId,
        },
        setActiveScopeId: jest.fn(),
      });
      const { toJSON } = render(<ScopeSelector />);
      return { label, tree: toJSON() };
    }

    const single = (() => {
      mockUseDaemon.mockReturnValue({
        state: {
          ...initialState,
          identity: makeIdentity([{ scopeId: 'p-kota', displayName: 'kota' }]),
          activeScopeId: 'p-kota',
        },
        setActiveScopeId: jest.fn(),
      });
      const { toJSON } = render(<ScopeSelector />);
      return { label: 'single-scope (KOTA-on-itself)', tree: toJSON() };
    })();
    const multiDefault = snapshot('multi-scope (default selected)', 'p-kota');
    const multiSwitched = snapshot('multi-scope (operator switched to p-side)', 'p-side');

    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      JSON.stringify(
        {
          surface:
            'clients/mobile/src/components/ScopeSelector.tsx (mounted in StatusScreen)',
          generatedBy:
            'clients/mobile/src/__tests__/ScopeSelector.test.tsx',
          states: [single, multiDefault, multiSwitched],
        },
        null,
        2,
      ),
      'utf8',
    );
  });
});

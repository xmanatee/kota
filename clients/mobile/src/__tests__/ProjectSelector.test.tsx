import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ProjectSelector } from '../components/ProjectSelector';
import { initialState } from '../context/state';
import type { ClientIdentity } from '../daemon/core';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function makeIdentity(projects: { projectId: string; displayName: string }[]): ClientIdentity {
  return {
    projectName: 'kota',
    projectDir: '/tmp/kota',
    daemonVersion: '0.1.0',
    pid: 1,
    startedAt: 't',
    projects: {
      defaultProjectId: projects[0]!.projectId,
      projects: projects.map((p) => ({
        projectId: p.projectId,
        projectDir: `/tmp/${p.projectId}`,
        displayName: p.displayName,
      })),
    },
  };
}

describe('ProjectSelector', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('hides itself when the daemon hosts a single project', () => {
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([{ projectId: 'p-kota', displayName: 'kota' }]),
        activeProjectId: 'p-kota',
      },
      setActiveProjectId: jest.fn(),
    });
    const { queryByTestId } = render(<ProjectSelector />);
    expect(queryByTestId('project-selector')).toBeNull();
  });

  test('renders one chip per project and highlights the active one', () => {
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([
          { projectId: 'p-kota', displayName: 'kota' },
          { projectId: 'p-side', displayName: 'side-project' },
        ]),
        activeProjectId: 'p-kota',
      },
      setActiveProjectId: jest.fn(),
    });
    const { getByTestId, getByText } = render(<ProjectSelector />);
    expect(getByTestId('project-selector')).toBeTruthy();
    expect(getByTestId('project-selector-chip-p-kota')).toBeTruthy();
    expect(getByTestId('project-selector-chip-p-side')).toBeTruthy();
    expect(getByText('kota')).toBeTruthy();
    expect(getByText('side-project')).toBeTruthy();
  });

  test('tapping a chip drives setActiveProjectId with that project id', () => {
    const setActiveProjectId = jest.fn();
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        identity: makeIdentity([
          { projectId: 'p-kota', displayName: 'kota' },
          { projectId: 'p-side', displayName: 'side-project' },
        ]),
        activeProjectId: 'p-kota',
      },
      setActiveProjectId,
    });
    const { getByTestId } = render(<ProjectSelector />);
    fireEvent.press(getByTestId('project-selector-chip-p-side'));
    expect(setActiveProjectId).toHaveBeenCalledWith('p-side');
  });

  test('hides itself when identity has not resolved yet', () => {
    mockUseDaemon.mockReturnValue({
      state: { ...initialState, identity: null, activeProjectId: null },
      setActiveProjectId: jest.fn(),
    });
    const { queryByTestId } = render(<ProjectSelector />);
    expect(queryByTestId('project-selector')).toBeNull();
  });

  test('writes the rendered tree to .kota/runs/<run-id>/ as the mobile rendered-evidence artifact', () => {
    const dest =
      process.env.KOTA_RUN_DIR
        ? resolve(process.env.KOTA_RUN_DIR, 'rendered-mobile-project-selector.json')
        : null;
    if (!dest) return;

    function snapshot(label: string, activeId: string | null): unknown {
      mockUseDaemon.mockReturnValue({
        state: {
          ...initialState,
          identity: makeIdentity([
            { projectId: 'p-kota', displayName: 'kota' },
            { projectId: 'p-side', displayName: 'side-project' },
          ]),
          activeProjectId: activeId,
        },
        setActiveProjectId: jest.fn(),
      });
      const { toJSON } = render(<ProjectSelector />);
      return { label, tree: toJSON() };
    }

    const single = (() => {
      mockUseDaemon.mockReturnValue({
        state: {
          ...initialState,
          identity: makeIdentity([{ projectId: 'p-kota', displayName: 'kota' }]),
          activeProjectId: 'p-kota',
        },
        setActiveProjectId: jest.fn(),
      });
      const { toJSON } = render(<ProjectSelector />);
      return { label: 'single-project (KOTA-on-itself)', tree: toJSON() };
    })();
    const multiDefault = snapshot('multi-project (default selected)', 'p-kota');
    const multiSwitched = snapshot('multi-project (operator switched to p-side)', 'p-side');

    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      JSON.stringify(
        {
          surface:
            'clients/mobile/src/components/ProjectSelector.tsx (mounted in StatusScreen)',
          generatedBy:
            'clients/mobile/src/__tests__/ProjectSelector.test.tsx',
          states: [single, multiDefault, multiSwitched],
        },
        null,
        2,
      ),
      'utf8',
    );
  });
});

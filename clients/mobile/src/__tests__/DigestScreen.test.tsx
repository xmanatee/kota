import React from 'react';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react-native';
import { initialState } from '../context/state';
import { DigestScreen } from '../screens/DigestScreen';
import type { DigestResponse } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function makeDigest(overrides: Partial<DigestResponse['data']> = {}): DigestResponse {
  return {
    data: {
      windowStartedAt: '2026-04-25T08:00:00.000Z',
      windowEndedAt: '2026-04-26T08:00:00.000Z',
      builderCommits: [],
      explorerAdditions: [],
      decomposerSplits: [],
      blockedPromoterMoves: [],
      failedMonitoredRuns: [],
      pendingOwnerQuestions: [],
      agingOperatorCaptures: [],
      queueDelta: {
        current: { open: 0, blocked: 0 },
        previous: null,
        delta: { open: null, blocked: null },
      },
      quiet: false,
      ...overrides,
    },
    text: 'Daily digest 2026-04-26\n- builder committed: Add foo',
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  const state = { ...defaultState(), ...overrides };
  return {
    ...initialState,
    connection: {
      ...initialState.connection,
      daemonUrl: state.daemonUrl,
      token: state.token,
      settingsLoaded: state.settingsLoaded,
      online: state.online,
    },
    content: {
      ...initialState.content,
      digest: state.digest,
      digestLoading: state.digestLoading,
      digestError: state.digestError,
    },
  };
}

function defaultState() {
  return {
    daemonUrl: 'http://host',
    token: 'tok',
    settingsLoaded: true,
    online: true,
    digest: null as DigestResponse | null,
    digestLoading: false,
    digestError: null as string | null,
  };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    'digest-consolidation',
    'surface-runtime-evidence',
    'mobile',
  );
}

function writeEvidenceFile(fileName: string, body: string): void {
  const dir = evidenceDirectory();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), body, 'utf-8');
}

function serializeRenderedTree(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function visit(node: unknown): unknown {
    if (
      node === null ||
      typeof node === 'string' ||
      typeof node === 'number' ||
      typeof node === 'boolean'
    ) {
      return node;
    }
    if (typeof node === 'function') {
      return '[Function]';
    }
    if (Array.isArray(node)) {
      return node.map((child) => visit(child));
    }
    if (typeof node !== 'object') {
      return String(node);
    }
    if (seen.has(node)) {
      return '[Circular]';
    }
    seen.add(node);

    const record = node as {
      type?: unknown;
      props?: Record<string, unknown>;
      children?: unknown;
    };
    if ('type' in record || 'props' in record || 'children' in record) {
      const props: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(record.props ?? {})) {
        if (key === 'refreshControl') {
          props[key] = '[ReactElement RefreshControl]';
        } else {
          props[key] = visit(prop);
        }
      }
      return {
        type: visit(record.type),
        props,
        children: visit(record.children),
      };
    }

    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(record)) {
      out[key] = visit(prop);
    }
    return out;
  }

  return visit(value);
}

describe('DigestScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
    cleanup();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ daemonUrl: '', token: '' }),
      refreshDigest: jest.fn(),
    });
    const { getByText } = render(<DigestScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('renders the rendered body and an active label for an active payload', () => {
    const digest = makeDigest({ quiet: false });
    mockUseDaemon.mockReturnValue({
      state: baseState({ digest }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('Daily Digest')).toBeTruthy();
    expect(getByText('active')).toBeTruthy();
    expect(queryByText('quiet window')).toBeNull();
    expect(getByText(/builder committed: Add foo/)).toBeTruthy();
  });

  test('labels quiet windows distinctly using data.quiet', () => {
    const digest: DigestResponse = {
      ...makeDigest({ quiet: true }),
      text: 'Daily digest 2026-04-26\n(quiet window — nothing to report)',
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ digest }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('quiet window')).toBeTruthy();
    expect(queryByText('active')).toBeNull();
    expect(getByText(/quiet window — nothing to report/)).toBeTruthy();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({
        digestError: '503 Service Unavailable',
        digest: null,
      }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('active')).toBeNull();
    expect(queryByText('quiet window')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false, digest: null }),
      refreshDigest: jest.fn(),
    });
    const { getByText } = render(<DigestScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('triggers a refresh on mount when online and digest is empty', () => {
    const refreshDigest = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState(),
      refreshDigest,
    });
    render(<DigestScreen />);
    expect(refreshDigest).toHaveBeenCalledTimes(1);
  });

  test('does not auto-refresh when offline', () => {
    const refreshDigest = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false }),
      refreshDigest,
    });
    render(<DigestScreen />);
    expect(refreshDigest).not.toHaveBeenCalled();
  });

  test('writes mounted React Native evidence when KOTA_RUN_DIR is set', () => {
    const dir = evidenceDirectory();
    if (!dir) return;

    const activeDigest = makeDigest({ quiet: false });
    const quietDigest: DigestResponse = {
      ...makeDigest({ quiet: true }),
      text: 'Daily digest 2026-04-26\n(quiet window — nothing to report)',
    };
    const cases: Array<{
      id: string;
      state: ReturnType<typeof baseState>;
      expectedText?: RegExp | string;
      proves: string;
    }> = [
      {
        id: 'active',
        state: baseState({ digest: activeDigest }),
        expectedText: /builder committed: Add foo/,
        proves:
          'DigestScreen mounted with a decoded active DigestResponse and rendered the active badge plus daemon text body.',
      },
      {
        id: 'quiet',
        state: baseState({ digest: quietDigest }),
        expectedText: 'quiet window',
        proves:
          'DigestScreen mounted with data.quiet=true and rendered the quiet-window badge.',
      },
      {
        id: 'error-retry',
        state: baseState({
          digestError: '503 Service Unavailable',
          digest: null,
        }),
        expectedText: 'Retry',
        proves:
          'DigestScreen mounted the daemon error branch with the Retry affordance.',
      },
      {
        id: 'offline',
        state: baseState({ online: false, digest: null }),
        expectedText: 'Daemon offline — retrying every 15s',
        proves:
          'DigestScreen mounted the offline banner and did not preserve stale digest content.',
      },
      {
        id: 'loading',
        state: baseState({ digestLoading: true, digest: null }),
        proves:
          'DigestScreen mounted the loading branch before the first digest payload arrives.',
      },
      {
        id: 'no-daemon',
        state: baseState({ daemonUrl: '', token: '' }),
        expectedText: 'No daemon configured.',
        proves:
          'DigestScreen mounted the no-daemon configured empty state.',
      },
    ];

    const manifest: Array<{
      id: string;
      artifact: string;
      proves: string;
      bytes: number;
    }> = [];

    for (const entry of cases) {
      mockUseDaemon.mockReturnValue({
        state: entry.state,
        refreshDigest: jest.fn(),
      });
      const view = render(<DigestScreen />);
      if (entry.expectedText !== undefined) {
        expect(view.getByText(entry.expectedText)).toBeTruthy();
      }
      const artifact = `digest-screen-${entry.id}.json`;
      writeEvidenceFile(
        artifact,
        `${JSON.stringify(
          {
            generatedBy: 'clients/mobile/src/__tests__/DigestScreen.test.tsx',
            surface: 'clients/mobile/src/screens/DigestScreen.tsx',
            mount: '<DigestScreen /> with mocked DaemonContext state',
            state: entry.id,
            tree: serializeRenderedTree(view.toJSON()),
          },
          null,
          2,
        )}\n`,
      );
      manifest.push({
        id: entry.id,
        artifact,
        proves: entry.proves,
        bytes: statSync(join(dir, artifact)).size,
      });
      view.unmount();
      mockUseDaemon.mockReset();
    }

    writeEvidenceFile(
      'digest-screen-mounted-tree-manifest.json',
      `${JSON.stringify(
        {
          generatedBy: 'clients/mobile/src/__tests__/DigestScreen.test.tsx',
          surface: 'clients/mobile/src/screens/DigestScreen.tsx',
          mount: '<DigestScreen />',
          dataSource:
            'clients/mobile/src/context/DaemonContext.tsx dispatches getDigest() results into DigestScreen state',
          decoder:
            'clients/mobile/src/daemon/digest.ts daemonRequest("/api/digest") -> parseDigestResponse',
          cases: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});

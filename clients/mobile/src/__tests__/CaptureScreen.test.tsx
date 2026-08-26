import React from 'react';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { initialState } from '../context/state';
import { CaptureScreen } from '../screens/CaptureScreen';
import { renderCaptureResultPlain } from '../captureRender';
import type { CaptureResult } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function defaultState() {
  return {
    daemonUrl: 'http://host',
    token: 'tok',
    settingsLoaded: true,
    online: true,
    captureText: '',
    captureTarget: 'auto' as 'auto' | 'memory' | 'knowledge' | 'tasks' | 'inbox',
    captureHint: '',
    captureResult: null as CaptureResult | null,
    captureLoading: false,
    captureError: null as string | null,
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
      captureText: state.captureText,
      captureTarget: state.captureTarget,
      captureHint: state.captureHint,
      captureResult: state.captureResult,
      captureLoading: state.captureLoading,
      captureError: state.captureError,
    },
  };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setCaptureText?: jest.Mock;
    setCaptureTarget?: jest.Mock;
    setCaptureHint?: jest.Mock;
    capture?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setCaptureText: fns.setCaptureText ?? jest.fn(),
    setCaptureTarget: fns.setCaptureTarget ?? jest.fn(),
    setCaptureHint: fns.setCaptureHint ?? jest.fn(),
    capture: fns.capture ?? jest.fn().mockResolvedValue(undefined),
  });
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    'capture-consolidation',
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

describe('CaptureScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
    cleanup();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-text usage hint when no draft has been entered', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<CaptureScreen />);
    expect(
      getByText(
        'Type a note and tap Capture to route it across memory, knowledge, tasks, or inbox.',
      ),
    ).toBeTruthy();
    expect(queryByText(/captured to/i)).toBeNull();
  });

  test('disables Capture and skips the request for a whitespace-only draft', () => {
    const capture = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ captureText: '   ' }, { capture });
    const { getByLabelText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Submit capture'));
    expect(capture).not.toHaveBeenCalled();
  });

  test('Capture button calls capture with the trimmed text and no filter when target=auto and no hint', () => {
    const capture = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { captureText: '  remember the milk  ', captureTarget: 'auto' },
      { capture },
    );
    const { getByLabelText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Submit capture'));
    expect(capture).toHaveBeenCalledWith('remember the milk', undefined);
  });

  test('Capture button forwards target and hint when both are set', () => {
    const capture = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        captureText: 'buy milk',
        captureTarget: 'tasks',
        captureHint: 'shopping',
      },
      { capture },
    );
    const { getByLabelText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Submit capture'));
    expect(capture).toHaveBeenCalledWith('buy milk', {
      target: 'tasks',
      hint: 'shopping',
    });
  });

  test('renders an ok tasks success arm — body line carries the path so the filesystem-backed record stays visible', () => {
    const result: CaptureResult = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-buy-milk',
        path: 'data/tasks/ready/task-buy-milk.md',
      },
    };
    mockDaemon({ captureText: 'buy milk', captureResult: result });
    const { getByText, getAllByText } = render(<CaptureScreen />);
    expect(getByText('captured to tasks')).toBeTruthy();
    expect(getAllByText('tasks').length).toBeGreaterThan(0);
    expect(
      getByText(
        'Captured: tasks  task-buy-milk  data/tasks/ready/task-buy-milk.md',
      ),
    ).toBeTruthy();
    expect(getByText(renderCaptureResultPlain(result))).toBeTruthy();
  });

  test('renders an ok memory success arm — body line omits the path so the no-path arm is exercised', () => {
    const result: CaptureResult = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    mockDaemon({ captureText: 'note', captureResult: result });
    const { getByText, queryByText } = render(<CaptureScreen />);
    expect(getByText('captured to memory')).toBeTruthy();
    expect(getByText('Captured: memory  mem-7')).toBeTruthy();
    expect(queryByText(/data\/tasks/)).toBeNull();
    expect(queryByText(/data\/inbox/)).toBeNull();
    expect(getByText(renderCaptureResultPlain(result))).toBeTruthy();
  });

  test('renders the ambiguous arm with suggestion buttons that re-issue capture against the chosen target', () => {
    const result: CaptureResult = {
      ok: false,
      reason: 'ambiguous',
      suggestions: ['knowledge', 'memory'],
    };
    const capture = jest.fn().mockResolvedValue(undefined);
    const setCaptureTarget = jest.fn();
    mockDaemon(
      { captureText: 'a fact about a place', captureResult: result },
      { capture, setCaptureTarget },
    );
    const { getByText, getByLabelText } = render(<CaptureScreen />);
    expect(getByText('ambiguous')).toBeTruthy();
    expect(
      getByText(
        'Ambiguous capture. Re-run with --target <one of: knowledge, memory>.',
      ),
    ).toBeTruthy();
    expect(getByText(renderCaptureResultPlain(result))).toBeTruthy();

    fireEvent.press(getByLabelText('Re-issue capture into memory'));
    expect(setCaptureTarget).toHaveBeenCalledWith('memory');
    expect(capture).toHaveBeenCalledWith('a fact about a place', {
      target: 'memory',
    });
  });

  test('renders the no_contributors arm with the canonical unconfigured body line', () => {
    const result: CaptureResult = { ok: false, reason: 'no_contributors' };
    mockDaemon({ captureText: 'anything', captureResult: result });
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('unconfigured')).toBeTruthy();
    expect(
      getByText('Cross-store capture has no registered contributors.'),
    ).toBeTruthy();
    expect(getByText(renderCaptureResultPlain(result))).toBeTruthy();
  });

  test('renders the contributor_failed arm with the target badge and the canonical body carrying the verbatim message', () => {
    const result: CaptureResult = {
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach scope root',
    };
    mockDaemon({ captureText: 'forced to inbox', captureResult: result });
    const { getByText, getAllByText } = render(<CaptureScreen />);
    expect(getByText('contributor failed')).toBeTruthy();
    expect(getAllByText('inbox').length).toBeGreaterThan(0);
    expect(
      getByText(
        'Capture into inbox failed: inbox writer cannot reach scope root',
      ),
    ).toBeTruthy();
    expect(getByText(renderCaptureResultPlain(result))).toBeTruthy();
  });

  test('surfaces the daemon HTTP error and offers retry instead of degrading silently', () => {
    mockDaemon({
      captureText: 'note',
      captureError: '503 Service Unavailable',
      captureResult: null,
    });
    const { getByText, queryByText } = render(<CaptureScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('unconfigured')).toBeNull();
    expect(queryByText('contributor failed')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no draft has been entered', () => {
    const capture = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { capture });
    render(<CaptureScreen />);
    expect(capture).not.toHaveBeenCalled();
  });

  test('picker chip taps update the target without auto-submitting', () => {
    const capture = jest.fn().mockResolvedValue(undefined);
    const setCaptureTarget = jest.fn();
    mockDaemon({ captureText: 'note' }, { capture, setCaptureTarget });
    const { getByLabelText } = render(<CaptureScreen />);
    fireEvent.press(getByLabelText('Capture target tasks'));
    expect(setCaptureTarget).toHaveBeenCalledWith('tasks');
    expect(capture).not.toHaveBeenCalled();
  });

  test('writes mounted React Native evidence when KOTA_RUN_DIR is set', () => {
    const dir = evidenceDirectory();
    if (!dir) return;

    const successMemory: CaptureResult = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    const successKnowledge: CaptureResult = {
      ok: true,
      record: { target: 'knowledge', recordId: 'kn-capture-mobile' },
    };
    const successTasks: CaptureResult = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-buy-milk',
        path: 'data/tasks/ready/task-buy-milk.md',
      },
    };
    const successInbox: CaptureResult = {
      ok: true,
      record: {
        target: 'inbox',
        recordId: 'inbox-capture-mobile',
        path: 'data/inbox/capture-mobile.md',
      },
    };
    const ambiguous: CaptureResult = {
      ok: false,
      reason: 'ambiguous',
      suggestions: ['memory', 'knowledge', 'tasks', 'inbox'],
    };
    const noContributors: CaptureResult = {
      ok: false,
      reason: 'no_contributors',
    };
    const contributorFailed: CaptureResult = {
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach scope root',
    };

    const cases: Array<{
      id: string;
      state: ReturnType<typeof baseState>;
      expectedText?: RegExp | string;
      proves: string;
    }> = [
      {
        id: 'empty',
        state: baseState({ captureText: '' }),
        expectedText:
          'Type a note and tap Capture to route it across memory, knowledge, tasks, or inbox.',
        proves:
          'CaptureScreen mounted the empty form, target chips, optional hint field, and usage hint before any request.',
      },
      {
        id: 'loading',
        state: baseState({ captureText: 'capture me', captureLoading: true }),
        proves:
          'CaptureScreen rendered the loading state and disabled submit while a capture is pending.',
      },
      {
        id: 'success-memory',
        state: baseState({ captureText: 'note', captureResult: successMemory }),
        expectedText: 'Captured: memory  mem-7',
        proves:
          'CaptureScreen rendered the memory success arm and canonical shared body line.',
      },
      {
        id: 'success-knowledge',
        state: baseState({
          captureText: 'note',
          captureResult: successKnowledge,
        }),
        expectedText: 'Captured: knowledge  kn-capture-mobile',
        proves:
          'CaptureScreen rendered the knowledge success arm and canonical shared body line.',
      },
      {
        id: 'success-tasks',
        state: baseState({ captureText: 'note', captureResult: successTasks }),
        expectedText:
          'Captured: tasks  task-buy-milk  data/tasks/ready/task-buy-milk.md',
        proves:
          'CaptureScreen rendered the tasks success arm with filesystem path metadata.',
      },
      {
        id: 'success-inbox',
        state: baseState({ captureText: 'note', captureResult: successInbox }),
        expectedText:
          'Captured: inbox  inbox-capture-mobile  data/inbox/capture-mobile.md',
        proves:
          'CaptureScreen rendered the inbox success arm with filesystem path metadata.',
      },
      {
        id: 'ambiguous',
        state: baseState({ captureText: 'note', captureResult: ambiguous }),
        expectedText:
          'Ambiguous capture. Re-run with --target <one of: memory, knowledge, tasks, inbox>.',
        proves:
          'CaptureScreen rendered the ambiguous arm with all four suggestion chips.',
      },
      {
        id: 'no-contributors',
        state: baseState({
          captureText: 'anything',
          captureResult: noContributors,
        }),
        expectedText: 'Cross-store capture has no registered contributors.',
        proves:
          'CaptureScreen rendered the typed no_contributors unavailable state.',
      },
      {
        id: 'contributor-failed',
        state: baseState({
          captureText: 'forced to inbox',
          captureResult: contributorFailed,
        }),
        expectedText:
          'Capture into inbox failed: inbox writer cannot reach scope root',
        proves:
          'CaptureScreen rendered contributor_failed with target badge and verbatim daemon message.',
      },
      {
        id: 'http-error-retry',
        state: baseState({
          captureText: 'note',
          captureError: '503 Service Unavailable',
          captureResult: null,
        }),
        expectedText: 'Retry',
        proves:
          'CaptureScreen surfaced the daemon HTTP error with a retry affordance instead of degrading silently.',
      },
      {
        id: 'offline',
        state: baseState({ online: false }),
        expectedText: 'Daemon offline — retrying every 15s',
        proves:
          'CaptureScreen rendered the daemon-offline banner and disabled request path.',
      },
      {
        id: 'no-daemon',
        state: baseState({ daemonUrl: '', token: '' }),
        expectedText: 'No daemon configured.',
        proves:
          'CaptureScreen rendered the missing-daemon setup state.',
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
        setCaptureText: jest.fn(),
        setCaptureTarget: jest.fn(),
        setCaptureHint: jest.fn(),
        capture: jest.fn().mockResolvedValue(undefined),
      });
      const rendered = render(<CaptureScreen />);
      if (entry.expectedText) {
        expect(rendered.getByText(entry.expectedText)).toBeTruthy();
      }
      const artifact = `capture-screen-${entry.id}.json`;
      writeEvidenceFile(
        artifact,
        `${JSON.stringify(
          {
            generatedBy: 'clients/mobile/src/__tests__/CaptureScreen.test.tsx',
            surface: 'clients/mobile/src/screens/CaptureScreen.tsx',
            mount: '<CaptureScreen /> with mocked DaemonContext state',
            state: entry.id,
            tree: serializeRenderedTree(rendered.toJSON()),
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
      rendered.unmount();
      mockUseDaemon.mockReset();
    }

    writeEvidenceFile(
      'capture-screen-mounted-tree-manifest.json',
      `${JSON.stringify(
        {
          generatedBy: 'clients/mobile/src/__tests__/CaptureScreen.test.tsx',
          surface: 'clients/mobile/src/screens/CaptureScreen.tsx',
          mount: '<CaptureScreen /> with mocked DaemonContext state',
          requestPath:
            "clients/mobile/src/daemon/capture.ts daemonRequest('/api/capture') + parseCaptureResult",
          cases: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});

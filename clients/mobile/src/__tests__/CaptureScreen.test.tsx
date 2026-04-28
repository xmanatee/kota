import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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
    sseConnected: true,
    status: null,
    runs: [],
    approvals: [],
    ownerQuestions: [],
    tasks: null,
    pendingApprovalCount: 0,
    pendingOwnerQuestionCount: 0,
    pushNotificationsEnabled: true,
    error: null,
    digest: null,
    digestLoading: false,
    digestError: null,
    attention: null,
    attentionLoading: false,
    attentionError: null,
    knowledgeQuery: '',
    knowledgeResult: null,
    knowledgeLoading: false,
    knowledgeError: null,
    memoryQuery: '',
    memoryResult: null,
    memoryLoading: false,
    memoryError: null,
    historyQuery: '',
    historyResult: null,
    historyLoading: false,
    historyError: null,
    tasksQuery: '',
    tasksResult: null,
    tasksLoading: false,
    tasksError: null,
    recallQuery: '',
    recallResult: null,
    recallLoading: false,
    recallError: null,
    answerQuery: '',
    answerResult: null,
    answerLoading: false,
    answerError: null,
    captureText: '',
    captureTarget: 'auto' as 'auto' | 'memory' | 'knowledge' | 'tasks' | 'inbox',
    captureHint: '',
    captureResult: null as CaptureResult | null,
    captureLoading: false,
    captureError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
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

describe('CaptureScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
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
      message: 'inbox writer cannot reach project root',
    };
    mockDaemon({ captureText: 'forced to inbox', captureResult: result });
    const { getByText, getAllByText } = render(<CaptureScreen />);
    expect(getByText('contributor failed')).toBeTruthy();
    expect(getAllByText('inbox').length).toBeGreaterThan(0);
    expect(
      getByText(
        'Capture into inbox failed: inbox writer cannot reach project root',
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
});

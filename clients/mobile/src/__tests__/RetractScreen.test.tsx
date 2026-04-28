import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { renderRetractResultPlain } from '../retractRender';
import { RetractScreen } from '../screens/RetractScreen';
import type { RetractResult, RetractTarget } from '../types';

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
    captureResult: null,
    captureLoading: false,
    captureError: null,
    retractTarget: 'memory' as RetractTarget,
    retractIdentifier: '',
    retractResult: null as RetractResult | null,
    retractLoading: false,
    retractError: null as string | null,
    retractConfirmed: false,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setRetractTarget?: jest.Mock;
    setRetractIdentifier?: jest.Mock;
    setRetractConfirmed?: jest.Mock;
    retract?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setRetractTarget: fns.setRetractTarget ?? jest.fn(),
    setRetractIdentifier: fns.setRetractIdentifier ?? jest.fn(),
    setRetractConfirmed: fns.setRetractConfirmed ?? jest.fn(),
    retract: fns.retract ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('RetractScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<RetractScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-identifier usage hint when no draft has been entered', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<RetractScreen />);
    expect(
      getByText(
        'Pick a store, type the identifier, then tap Retract to remove the record.',
      ),
    ).toBeTruthy();
    expect(queryByText(/retracted from/i)).toBeNull();
  });

  test('disables Retract and skips the action for a whitespace-only draft', () => {
    const setRetractConfirmed = jest.fn();
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { retractTarget: 'memory', retractIdentifier: '   ' },
      { setRetractConfirmed, retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Submit retract'));
    expect(setRetractConfirmed).not.toHaveBeenCalled();
    expect(retract).not.toHaveBeenCalled();
  });

  test('first submit flips to confirmation gate without firing the request', () => {
    const setRetractConfirmed = jest.fn();
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { retractTarget: 'memory', retractIdentifier: 'mem-7' },
      { setRetractConfirmed, retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Submit retract'));
    expect(setRetractConfirmed).toHaveBeenCalledWith(true);
    expect(retract).not.toHaveBeenCalled();
  });

  test('second submit (after confirmation) fires the request with the typed memory arm', () => {
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        retractTarget: 'memory',
        retractIdentifier: '  mem-7  ',
        retractConfirmed: true,
      },
      { retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Confirm retract'));
    expect(retract).toHaveBeenCalledWith({ target: 'memory', id: 'mem-7' });
  });

  test('confirmed submit fires the typed knowledge slug arm (per-target identifier narrowing)', () => {
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        retractTarget: 'knowledge',
        retractIdentifier: 'autonomy-loop',
        retractConfirmed: true,
      },
      { retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Confirm retract'));
    expect(retract).toHaveBeenCalledWith({
      target: 'knowledge',
      slug: 'autonomy-loop',
    });
  });

  test('confirmed submit fires the typed tasks id arm', () => {
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        retractTarget: 'tasks',
        retractIdentifier: 'task-buy-milk',
        retractConfirmed: true,
      },
      { retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Confirm retract'));
    expect(retract).toHaveBeenCalledWith({
      target: 'tasks',
      id: 'task-buy-milk',
    });
  });

  test('confirmed submit fires the typed inbox path arm', () => {
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        retractTarget: 'inbox',
        retractIdentifier: 'data/inbox/note-foo.md',
        retractConfirmed: true,
      },
      { retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Confirm retract'));
    expect(retract).toHaveBeenCalledWith({
      target: 'inbox',
      path: 'data/inbox/note-foo.md',
    });
  });

  test('Cancel clears the confirmation gate without firing the request', () => {
    const setRetractConfirmed = jest.fn();
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      {
        retractTarget: 'memory',
        retractIdentifier: 'mem-7',
        retractConfirmed: true,
      },
      { setRetractConfirmed, retract },
    );
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Cancel retract confirmation'));
    expect(setRetractConfirmed).toHaveBeenCalledWith(false);
    expect(retract).not.toHaveBeenCalled();
  });

  test('picker chip taps update the target without auto-submitting', () => {
    const setRetractTarget = jest.fn();
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { setRetractTarget, retract });
    const { getByLabelText } = render(<RetractScreen />);
    fireEvent.press(getByLabelText('Retract target inbox'));
    expect(setRetractTarget).toHaveBeenCalledWith('inbox');
    expect(retract).not.toHaveBeenCalled();
  });

  test('renders the success arm for a tasks record — body line carries previousPath/path/toState', () => {
    const result: RetractResult = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-foo',
        previousPath: 'data/tasks/ready/task-foo.md',
        path: 'data/tasks/dropped/task-foo.md',
        toState: 'dropped',
      },
    };
    mockDaemon({
      retractTarget: 'tasks',
      retractIdentifier: 'task-foo',
      retractResult: result,
    });
    const { getByText, getAllByText } = render(<RetractScreen />);
    expect(getByText('retracted from tasks')).toBeTruthy();
    expect(getAllByText('tasks').length).toBeGreaterThan(0);
    expect(getByText(renderRetractResultPlain(result))).toBeTruthy();
    expect(
      getByText(
        'Retracted: tasks  task-foo  data/tasks/ready/task-foo.md -> data/tasks/dropped/task-foo.md (dropped)',
      ),
    ).toBeTruthy();
    expect(getAllByText('dropped').length).toBeGreaterThan(0);
  });

  test('renders the success arm for an inbox record — body line carries the unlinked path', () => {
    const result: RetractResult = {
      ok: true,
      record: {
        target: 'inbox',
        recordId: 'inbox-1',
        path: 'data/inbox/note-foo.md',
      },
    };
    mockDaemon({
      retractTarget: 'inbox',
      retractIdentifier: 'data/inbox/note-foo.md',
      retractResult: result,
    });
    const { getByText, getAllByText } = render(<RetractScreen />);
    expect(getByText('retracted from inbox')).toBeTruthy();
    expect(getAllByText('inbox').length).toBeGreaterThan(0);
    expect(
      getByText('Retracted: inbox  inbox-1  data/inbox/note-foo.md'),
    ).toBeTruthy();
  });

  test('renders the success arm for a memory record — body line omits any path', () => {
    const result: RetractResult = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    mockDaemon({
      retractTarget: 'memory',
      retractIdentifier: 'mem-7',
      retractResult: result,
    });
    const { getByText, queryByText } = render(<RetractScreen />);
    expect(getByText('retracted from memory')).toBeTruthy();
    expect(getByText('Retracted: memory  mem-7')).toBeTruthy();
    expect(queryByText(/data\//)).toBeNull();
  });

  test('renders the no_contributors arm with the canonical unconfigured body line', () => {
    const result: RetractResult = { ok: false, reason: 'no_contributors' };
    mockDaemon({ retractIdentifier: 'mem-7', retractResult: result });
    const { getByText } = render(<RetractScreen />);
    expect(getByText('no contributors')).toBeTruthy();
    expect(
      getByText(
        'Cross-store retract has no registered contributors for the named target.',
      ),
    ).toBeTruthy();
    expect(getByText(renderRetractResultPlain(result))).toBeTruthy();
  });

  test('renders the not_found arm echoing the submitted identifier verbatim', () => {
    const result: RetractResult = {
      ok: false,
      reason: 'not_found',
      target: 'memory',
      identifier: 'mem-missing',
    };
    mockDaemon({
      retractTarget: 'memory',
      retractIdentifier: 'mem-missing',
      retractResult: result,
    });
    const { getByText, getAllByText } = render(<RetractScreen />);
    expect(getByText('memory not found')).toBeTruthy();
    expect(getAllByText('memory').length).toBeGreaterThan(0);
    expect(
      getByText(
        'Retract memory: no record with identifier "mem-missing".',
      ),
    ).toBeTruthy();
  });

  test('renders the contributor_failed arm with target badge and verbatim message', () => {
    const result: RetractResult = {
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach project root',
    };
    mockDaemon({
      retractTarget: 'inbox',
      retractIdentifier: 'data/inbox/note-foo.md',
      retractResult: result,
    });
    const { getByText, getAllByText } = render(<RetractScreen />);
    expect(getByText('inbox failed')).toBeTruthy();
    expect(getAllByText('inbox').length).toBeGreaterThan(0);
    expect(
      getByText(
        'Retract from inbox failed: inbox writer cannot reach project root',
      ),
    ).toBeTruthy();
  });

  test('surfaces the daemon HTTP error without throwing', () => {
    mockDaemon({
      retractIdentifier: 'mem-7',
      retractError: '503 Service Unavailable',
      retractResult: null,
    });
    const { getByText, queryByText } = render(<RetractScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(queryByText('no contributors')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<RetractScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fire on mount with an empty draft', () => {
    const retract = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { retract });
    render(<RetractScreen />);
    expect(retract).not.toHaveBeenCalled();
  });

  test('field label narrows per target — memory shows id, knowledge shows slug, inbox shows path', () => {
    mockDaemon({ retractTarget: 'memory' });
    const { rerender, getByLabelText, queryByLabelText } = render(<RetractScreen />);
    expect(getByLabelText('Retract id')).toBeTruthy();

    mockDaemon({ retractTarget: 'knowledge' });
    rerender(<RetractScreen />);
    expect(getByLabelText('Retract slug')).toBeTruthy();
    expect(queryByLabelText('Retract id')).toBeNull();

    mockDaemon({ retractTarget: 'inbox' });
    rerender(<RetractScreen />);
    expect(getByLabelText('Retract path')).toBeTruthy();
  });
});

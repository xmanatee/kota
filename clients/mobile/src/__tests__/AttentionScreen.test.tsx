import React from 'react';
import { render } from '@testing-library/react-native';
import { AttentionScreen } from '../screens/AttentionScreen';
import type { AttentionResponse } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

const NO_ATTENTION_ITEMS_TEXT = 'No attention items right now.';

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
    attention: null as AttentionResponse | null,
    attentionLoading: false,
    attentionError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

describe('AttentionScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ daemonUrl: '', token: '' }),
      refreshAttention: jest.fn(),
    });
    const { getByText } = render(<AttentionScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('renders the attention body and item-count badge when items are present', () => {
    const attention: AttentionResponse = {
      data: {
        items: [
          { label: 'Owner question', detail: 'oq-1 pending 3d' },
          { label: 'Builder warnings', detail: '3/10' },
        ],
      },
      text: 'Attention required 2026-04-26\n- owner question pending\n- builder warnings repeating',
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ attention }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText } = render(<AttentionScreen />);
    expect(getByText('Attention')).toBeTruthy();
    expect(getByText('2 items')).toBeTruthy();
    expect(queryByText('nothing pending')).toBeNull();
    expect(getByText(/owner question pending/)).toBeTruthy();
  });

  test('renders the empty-state copy and "nothing pending" badge when items are empty', () => {
    const attention: AttentionResponse = {
      data: { items: [] },
      text: NO_ATTENTION_ITEMS_TEXT,
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ attention }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText } = render(<AttentionScreen />);
    expect(getByText('nothing pending')).toBeTruthy();
    expect(queryByText(/items?/)).toBeTruthy();
    expect(getByText(NO_ATTENTION_ITEMS_TEXT)).toBeTruthy();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({
        attentionError: '503 Service Unavailable',
        attention: null,
      }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText } = render(<AttentionScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('nothing pending')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false, attention: null }),
      refreshAttention: jest.fn(),
    });
    const { getByText } = render(<AttentionScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('triggers a refresh on mount when online and attention is empty', () => {
    const refreshAttention = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState(),
      refreshAttention,
    });
    render(<AttentionScreen />);
    expect(refreshAttention).toHaveBeenCalledTimes(1);
  });

  test('does not auto-refresh when offline', () => {
    const refreshAttention = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false }),
      refreshAttention,
    });
    render(<AttentionScreen />);
    expect(refreshAttention).not.toHaveBeenCalled();
  });

  test('renders the singular badge label when exactly one item is present', () => {
    const attention: AttentionResponse = {
      data: { items: [{ label: 'Owner question', detail: 'oq-1' }] },
      text: 'Attention required 2026-04-26\n- owner question pending',
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ attention }),
      refreshAttention: jest.fn(),
    });
    const { getByText } = render(<AttentionScreen />);
    expect(getByText('1 item')).toBeTruthy();
  });
});

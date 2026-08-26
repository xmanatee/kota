import React from 'react';
import { render } from '@testing-library/react-native';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActivityIndicator } from 'react-native';
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

function emitMobileAttentionEvidence(fileName: string, tree: unknown): void {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return;
  const dir = join(runDir, 'attention-operator-evidence', 'mobile');
  mkdirSync(dir, { recursive: true });
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(
    tree,
    (key, value: unknown) => {
      if (key === '_owner' || key === '_store' || key === 'ref') {
        return undefined;
      }
      if (typeof value === 'function') return '[Function]';
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    },
    2,
  );
  writeFileSync(join(dir, fileName), `${serialized}\n`, 'utf-8');
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
    const { getByText, toJSON } = render(<AttentionScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
    emitMobileAttentionEvidence('not-configured.json', toJSON());
  });

  test('renders the attention body and item-count badge when items are present', () => {
    const attention: AttentionResponse = {
      items: [
        { label: 'Owner question', detail: 'oq-1 pending 3d' },
        { label: 'Builder warnings', detail: '3/10' },
      ],
      text: 'Attention required 2026-04-26\n- owner question pending\n- builder warnings repeating',
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ attention }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText, toJSON } = render(<AttentionScreen />);
    expect(getByText('Attention')).toBeTruthy();
    expect(getByText('2 items')).toBeTruthy();
    expect(queryByText('nothing pending')).toBeNull();
    expect(getByText(/owner question pending/)).toBeTruthy();
    emitMobileAttentionEvidence('items-present.json', toJSON());
  });

  test('renders the empty-state copy and "nothing pending" badge when items are empty', () => {
    const attention: AttentionResponse = {
      items: [],
      text: NO_ATTENTION_ITEMS_TEXT,
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ attention }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText, toJSON } = render(<AttentionScreen />);
    expect(getByText('nothing pending')).toBeTruthy();
    expect(queryByText(/items?/)).toBeTruthy();
    expect(getByText(NO_ATTENTION_ITEMS_TEXT)).toBeTruthy();
    emitMobileAttentionEvidence('quiet.json', toJSON());
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({
        attentionError: '503 Service Unavailable',
        attention: null,
      }),
      refreshAttention: jest.fn(),
    });
    const { getByText, queryByText, toJSON } = render(<AttentionScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('nothing pending')).toBeNull();
    emitMobileAttentionEvidence('error-retry.json', toJSON());
  });

  test('shows offline banner when daemon is offline', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false, attention: null }),
      refreshAttention: jest.fn(),
    });
    const { getByText, toJSON } = render(<AttentionScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
    emitMobileAttentionEvidence('offline.json', toJSON());
  });

  test('renders a loading spinner while attention refresh is pending', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ attentionLoading: true, attention: null }),
      refreshAttention: jest.fn(),
    });
    const { UNSAFE_getByType, toJSON } = render(<AttentionScreen />);
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    emitMobileAttentionEvidence('loading.json', toJSON());
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
      items: [{ label: 'Owner question', detail: 'oq-1' }],
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

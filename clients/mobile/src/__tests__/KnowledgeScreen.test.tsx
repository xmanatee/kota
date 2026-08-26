import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KnowledgeScreen } from '../screens/KnowledgeScreen';
import { renderKnowledgeSearchPlain } from '../knowledgeRender';
import type { KnowledgeEntry, KnowledgeSearchResponse } from '../types';

function knowledgeEntry(
  values: Pick<KnowledgeEntry, 'id' | 'type' | 'status' | 'title'>,
): KnowledgeEntry {
  return {
    content: '',
    created: '2026-04-26T00:00:00.000Z',
    meta: {},
    tags: [],
    updated: '2026-04-26T00:00:00.000Z',
    ...values,
  };
}

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
    knowledgeResult: null as KnowledgeSearchResponse | null,
    knowledgeLoading: false,
    knowledgeError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setKnowledgeQuery?: jest.Mock;
    searchKnowledge?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setKnowledgeQuery: fns.setKnowledgeQuery ?? jest.fn(),
    searchKnowledge: fns.searchKnowledge ?? jest.fn().mockResolvedValue(undefined),
  });
}

function serializeRenderedTree(tree: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
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
}

function renderKnowledgeState(
  label: string,
  overrides: Partial<ReturnType<typeof defaultState>>,
): { label: string; tree: unknown } {
  mockDaemon(overrides);
  const { toJSON, unmount } = render(<KnowledgeScreen />);
  const tree = toJSON();
  unmount();
  return { label, tree };
}

describe('KnowledgeScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<KnowledgeScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no query has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<KnowledgeScreen />);
    expect(
      getByText('Type a query and tap Search to query knowledge.'),
    ).toBeTruthy();
    expect(queryByText('No matching knowledge entries.')).toBeNull();
  });

  test('disables the Search action and skips the request for a whitespace-only query', () => {
    const searchKnowledge = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ knowledgeQuery: '   ' }, { searchKnowledge });
    const { getByText } = render(<KnowledgeScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  test('renders populated results with the shared id/type/status/title line shape', () => {
    const result: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        knowledgeEntry({ id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' }),
        knowledgeEntry({ id: 'k-2', type: 'doc', status: 'archived', title: 'Old plan' }),
      ],
    };
    mockDaemon({ knowledgeQuery: 'autonomy', knowledgeResult: result });
    const { getByText, queryByText } = render(<KnowledgeScreen />);
    expect(getByText('2 entries')).toBeTruthy();
    const expected = renderKnowledgeSearchPlain(result.ok ? result.entries : []);
    expect(getByText(expected)).toBeTruthy();
    expect(expected).toBe(
      'k-1  note  active    Autonomy loop\nk-2  doc   archived  Old plan',
    );
    expect(queryByText('No matching knowledge entries.')).toBeNull();
  });

  test('renders the singular badge label when exactly one entry is present', () => {
    const result: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        knowledgeEntry({ id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' }),
      ],
    };
    mockDaemon({ knowledgeQuery: 'autonomy', knowledgeResult: result });
    const { getByText } = render(<KnowledgeScreen />);
    expect(getByText('1 entry')).toBeTruthy();
  });

  test('renders the empty-results body and "no matches" badge when the result is empty', () => {
    const result: KnowledgeSearchResponse = { ok: true, entries: [] };
    mockDaemon({ knowledgeQuery: 'autonomy', knowledgeResult: result });
    const { getByText } = render(<KnowledgeScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching knowledge entries.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: KnowledgeSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ knowledgeQuery: 'autonomy', knowledgeResult: result });
    const { getByText, queryByText } = render(<KnowledgeScreen />);
    expect(getByText('semantic unavailable')).toBeTruthy();
    expect(
      getByText(
        'Semantic knowledge search requires an embedding-backed knowledge provider.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching knowledge entries.')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      knowledgeQuery: 'autonomy',
      knowledgeError: '503 Service Unavailable',
      knowledgeResult: null,
    });
    const { getByText, queryByText } = render(<KnowledgeScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('semantic unavailable')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<KnowledgeScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const searchKnowledge = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { searchKnowledge });
    render(<KnowledgeScreen />);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  test('Search button calls searchKnowledge with the trimmed query', () => {
    const searchKnowledge = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ knowledgeQuery: '  autonomy  ' }, { searchKnowledge });
    const { getByText } = render(<KnowledgeScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchKnowledge).toHaveBeenCalledWith('autonomy');
  });

  test('writes rendered knowledge states to the run directory when requested', () => {
    const runDir = process.env.KOTA_RUN_DIR;
    if (!runDir) return;

    const populated: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        knowledgeEntry({
          id: 'kn-1',
          type: 'note',
          status: 'active',
          title: 'Knowledge fan-out',
        }),
        knowledgeEntry({
          id: 'kn-2',
          type: 'reference',
          status: 'draft',
          title: 'Daemon control protocol',
        }),
      ],
    };
    const empty: KnowledgeSearchResponse = { ok: true, entries: [] };
    const semanticUnavailable: KnowledgeSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };

    const states = [
      renderKnowledgeState('empty-query', {}),
      renderKnowledgeState('populated-results', {
        knowledgeQuery: 'fan-out',
        knowledgeResult: populated,
      }),
      renderKnowledgeState('empty-results', {
        knowledgeQuery: 'fan-out',
        knowledgeResult: empty,
      }),
      renderKnowledgeState('semantic-unavailable', {
        knowledgeQuery: 'fan-out',
        knowledgeResult: semanticUnavailable,
      }),
      renderKnowledgeState('http-error-retry', {
        knowledgeQuery: 'fan-out',
        knowledgeError: '503 Service Unavailable',
      }),
      renderKnowledgeState('offline-banner', { online: false }),
    ];

    const dir = join(runDir, 'knowledge-consolidation', 'surfaces', 'mobile');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'knowledge-screen-rendered.json'),
      `${serializeRenderedTree({
        surface: 'clients/mobile/src/screens/KnowledgeScreen.tsx',
        generatedBy: 'clients/mobile/src/__tests__/KnowledgeScreen.test.tsx',
        states,
      })}\n`,
      'utf-8',
    );
  });
});

import { DaemonClient } from '../daemonClient';
import { ContractDecodeError } from '../daemon/daemon-contract.generated';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DaemonClient', () => {
  const baseUrl = 'http://127.0.0.1:8765';
  const token = 'test-token';
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function client() {
    return new DaemonClient(baseUrl, token);
  }

  function lastCall(): FetchArgs {
    const all = fetchSpy.mock.calls as FetchArgs[];
    return all[all.length - 1];
  }

  function lastHeaders(): Record<string, string> {
    const init = lastCall()[1];
    return (init?.headers ?? {}) as Record<string, string>;
  }

  test('getDigest sends GET /api/digest with bearer token (active payload)', async () => {
    const active = {
      data: {
        windowStartedAt: '2026-04-25T08:00:00.000Z',
        windowEndedAt: '2026-04-26T08:00:00.000Z',
        builderCommits: [
          {
            runId: 'r-1',
            taskId: 'task-foo',
            taskTitle: 'Add foo',
            commitSubject: 'Add foo',
            durationMs: 60000,
          },
        ],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        queueDelta: {
          current: { backlog: 0, ready: 1, doing: 0, blocked: 8 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: false,
      },
      text: 'Daily digest 2026-04-26\n- builder committed: Add foo',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(active));
    const res = await client().getDigest();
    expect(lastCall()[0]).toBe(`${baseUrl}/api/digest`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(active);
    expect(res.data.quiet).toBe(false);
  });

  test('getDigest passes quiet payloads through unchanged', async () => {
    const quiet = {
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
          current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: true,
      },
      text: 'Daily digest 2026-04-26\n(quiet window — nothing to report)',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(quiet));
    const res = await client().getDigest();
    expect(res.data.quiet).toBe(true);
    expect(res.text).toContain('quiet window');
  });

  test('getDigest surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().getDigest()).rejects.toThrow('503');
  });

  test('getAttention sends GET /api/attention with bearer token (populated payload)', async () => {
    const populated = {
      items: [
        { label: 'Owner question', detail: 'oq-1 pending 3d' },
        { label: 'Builder warnings', detail: '3/10' },
      ],
      text: 'Attention required 2026-04-26\n- owner question pending\n- builder warnings repeating',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(populated));
    const res = await client().getAttention();
    expect(lastCall()[0]).toBe(`${baseUrl}/api/attention`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(populated);
    expect(res.items).toHaveLength(2);
  });

  test('getAttention passes through the empty-state envelope unchanged', async () => {
    const empty = {
      items: [],
      text: 'No attention items right now.',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(empty));
    const res = await client().getAttention();
    expect(res.items).toHaveLength(0);
    expect(res.text).toBe('No attention items right now.');
  });

  test('getAttention surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().getAttention()).rejects.toThrow('503');
  });

  test('searchKnowledge encodes query/semantic/limit and decodes the success branch', async () => {
    const success = {
      ok: true,
      entries: [
        { id: 'k-1', title: 'Autonomy loop', type: 'note', tags: [], status: 'active', created: '2026-04-26', updated: '2026-04-26', content: '', meta: {} },
        { id: 'k-2', title: 'Old plan', type: 'doc', tags: [], status: 'archived', created: '2026-04-26', updated: '2026-04-26', content: '', meta: {} },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().searchKnowledge('autonomy loop', 10);
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/knowledge/search?q=autonomy+loop&semantic=true&limit=10`,
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('searchKnowledge decodes the semantic-unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().searchKnowledge('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('searchKnowledge defaults limit to 10', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, entries: [] }));
    await client().searchKnowledge('x');
    const url = lastCall()[0] as string;
    expect(url).toContain('limit=10');
  });

  test('searchKnowledge rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().searchKnowledge('x')).rejects.toThrow(
      ContractDecodeError,
    );
  });

  test('searchKnowledge rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, entries: [{ id: 'k-1' }] }),
    );
    await expect(client().searchKnowledge('x')).rejects.toThrow(
      ContractDecodeError,
    );
  });

  test('searchKnowledge surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().searchKnowledge('x')).rejects.toThrow('503');
  });

  test('searchMemory encodes query/semantic/limit and decodes the success branch', async () => {
    const success = {
      ok: true,
      entries: [
        {
          id: 'm-1',
          created: '2026-04-26T12:00:00.000Z',
          content: 'autonomy loop notes',
        },
        {
          id: 'm-2',
          created: '2026-04-25T18:30:00.000Z',
          content: 'old plan',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().searchMemory('autonomy loop', 10);
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/memory/search?q=autonomy+loop&semantic=true&limit=10`,
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('searchMemory decodes the semantic-unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().searchMemory('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('searchMemory defaults limit to 10', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, entries: [] }));
    await client().searchMemory('x');
    const url = lastCall()[0] as string;
    expect(url).toContain('limit=10');
  });

  test('searchMemory rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().searchMemory('x')).rejects.toThrow(
      ContractDecodeError,
    );
  });

  test('searchMemory rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, entries: [{ id: 'm-1' }] }),
    );
    await expect(client().searchMemory('x')).rejects.toThrow(
      ContractDecodeError,
    );
  });

  test('searchMemory surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().searchMemory('x')).rejects.toThrow('503');
  });});

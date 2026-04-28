import { DaemonClient } from '../daemonClient';

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

  test('getStatus sends GET /status with bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ running: true, pid: 1, startedAt: 't', completedRuns: 0, workflow: {} }),
    );
    const c = client();
    await c.getStatus();

    expect(lastCall()[0]).toBe(`${baseUrl}/status`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(lastHeaders()['Content-Type']).toBe('application/json');
  });

  test('getRuns encodes optional workflow and limit', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ runs: [] }));
    const c = client();

    await c.getRuns();
    expect(lastCall()[0]).toBe(`${baseUrl}/workflow/runs?limit=20`);

    await c.getRuns('builder', 5);
    expect(lastCall()[0]).toBe(`${baseUrl}/workflow/runs?workflow=builder&limit=5`);
  });

  test('getRunDetail encodes id', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    await client().getRunDetail('run with space/slash');
    expect(lastCall()[0]).toBe(
      `${baseUrl}/workflow/runs/run%20with%20space%2Fslash`,
    );
  });

  test('approve posts optional note', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ approval: {} }));
    await client().approve('a1', 'looks good');

    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/approvals/a1/approve`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ note: 'looks good' }));
  });

  test('approve without note omits body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ approval: {} }));
    await client().approve('a1');
    const init = lastCall()[1];
    expect(init?.body).toBeUndefined();
  });

  test('reject posts optional reason', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ approval: {} }));
    await client().reject('a1', 'wrong');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/approvals/a1/reject`);
    expect(init?.body).toBe(JSON.stringify({ reason: 'wrong' }));
  });

  test('createSession posts to /sessions with empty body by default', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ session_id: 'sess' }));
    const res = await client().createSession();
    expect(lastCall()[0]).toBe(`${baseUrl}/sessions`);
    expect(lastCall()[1]?.method).toBe('POST');
    expect(lastCall()[1]?.body).toBe('{}');
    expect(res.session_id).toBe('sess');
  });

  test('createSession forwards autonomy mode when provided', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ session_id: 'sess', autonomy_mode: 'autonomous' }),
    );
    const res = await client().createSession('autonomous');
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ autonomy_mode: 'autonomous' }),
    );
    expect(res.autonomy_mode).toBe('autonomous');
  });

  test('setSessionAutonomyMode PATCHes /sessions/:id', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        session_id: 'sess',
        autonomy_mode: 'supervised',
        source: 'daemon',
        serveOwned: false,
      }),
    );
    const res = await client().setSessionAutonomyMode('sess/1', 'supervised');
    expect(lastCall()[0]).toBe(`${baseUrl}/sessions/sess%2F1`);
    expect(lastCall()[1]?.method).toBe('PATCH');
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ autonomy_mode: 'supervised' }),
    );
    expect(res.autonomy_mode).toBe('supervised');
    expect(res.source).toBe('daemon');
  });

  test('deleteSession tolerates 404', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(client().deleteSession('gone')).resolves.toBeUndefined();
  });

  test('deleteSession throws non-404 errors', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500, statusText: 'boom' }));
    await expect(client().deleteSession('x')).rejects.toThrow('500');
  });

  test('registerPushToken includes body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().registerPushToken('device-1', 'push-token');
    const init = lastCall()[1];
    expect(lastCall()[0]).toBe(`${baseUrl}/push-tokens`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ deviceId: 'device-1', token: 'push-token' }));
  });

  test('pauseDispatch and resumeDispatch POST expected paths', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ ok: true, paused: true }));
    await client().pauseDispatch();
    expect(lastCall()[0]).toBe(`${baseUrl}/workflow/pause`);
    await client().resumeDispatch();
    expect(lastCall()[0]).toBe(`${baseUrl}/workflow/resume`);
  });

  test('getOwnerQuestions sends GET /owner-questions with bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ questions: [] }));
    await client().getOwnerQuestions();
    expect(lastCall()[0]).toBe(`${baseUrl}/owner-questions`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
  });

  test('answerOwnerQuestion posts answer body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ question: {} }));
    await client().answerOwnerQuestion('oq-1', 'go ahead');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/owner-questions/oq-1/answer`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ answer: 'go ahead' }));
  });

  test('dismissOwnerQuestion posts optional reason', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ question: {} }));
    await client().dismissOwnerQuestion('oq-1', 'not needed');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/owner-questions/oq-1/dismiss`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ reason: 'not needed' }));
  });

  test('dismissOwnerQuestion without reason omits body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ question: {} }));
    await client().dismissOwnerQuestion('oq-1');
    const init = lastCall()[1];
    expect(init?.body).toBeUndefined();
  });

  test('throws on non-ok responses', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401, statusText: 'Unauthorized' }));
    await expect(client().getStatus()).rejects.toThrow('401');
  });

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
      data: {
        items: [
          { label: 'Owner question', detail: 'oq-1 pending 3d' },
          { label: 'Builder warnings', detail: '3/10' },
        ],
      },
      text: 'Attention required 2026-04-26\n- owner question pending\n- builder warnings repeating',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(populated));
    const res = await client().getAttention();
    expect(lastCall()[0]).toBe(`${baseUrl}/api/attention`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(populated);
    expect(res.data.items).toHaveLength(2);
  });

  test('getAttention passes through the empty-state envelope unchanged', async () => {
    const empty = {
      data: { items: [] },
      text: 'No attention items right now.',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(empty));
    const res = await client().getAttention();
    expect(res.data.items).toHaveLength(0);
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
        { id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' },
        { id: 'k-2', type: 'doc', status: 'archived', title: 'Old plan' },
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
    await expect(client().searchKnowledge('x')).rejects.toThrow(/mystery/);
  });

  test('searchKnowledge rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, entries: [{ id: 'k-1' }] }),
    );
    await expect(client().searchKnowledge('x')).rejects.toThrow(
      /knowledge entry/i,
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
    await expect(client().searchMemory('x')).rejects.toThrow(/mystery/);
  });

  test('searchMemory rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, entries: [{ id: 'm-1' }] }),
    );
    await expect(client().searchMemory('x')).rejects.toThrow(/memory entry/i);
  });

  test('searchMemory surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().searchMemory('x')).rejects.toThrow('503');
  });

  test('searchHistory encodes query/semantic/limit and decodes the success branch', async () => {
    const success = {
      ok: true,
      conversations: [
        {
          id: 'c-1',
          title: 'Autonomy loop debug',
          createdAt: '2026-04-26T10:00:00.000Z',
          updatedAt: '2026-04-26T12:00:00.000Z',
          model: 'claude-opus-4-7',
          messageCount: 12,
          cwd: '/Users/x/proj',
        },
        {
          id: 'c-2',
          title: 'Old plan',
          createdAt: '2026-04-25T16:00:00.000Z',
          updatedAt: '2026-04-25T18:30:00.000Z',
          model: 'claude-opus-4-7',
          messageCount: 3,
          cwd: '/Users/x/proj',
          source: 'user',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().searchHistory('autonomy loop', 10);
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/history/search?q=autonomy+loop&semantic=true&limit=10`,
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('searchHistory decodes the semantic-unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().searchHistory('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('searchHistory defaults limit to 10', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, conversations: [] }),
    );
    await client().searchHistory('x');
    const url = lastCall()[0] as string;
    expect(url).toContain('limit=10');
  });

  test('searchHistory rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().searchHistory('x')).rejects.toThrow(/mystery/);
  });

  test('searchHistory rejects a malformed conversation loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, conversations: [{ id: 'c-1' }] }),
    );
    await expect(client().searchHistory('x')).rejects.toThrow(
      /conversation record/i,
    );
  });

  test('searchHistory surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().searchHistory('x')).rejects.toThrow('503');
  });

  test('searchTasks encodes query/semantic/limit and decodes the success branch', async () => {
    const success = {
      ok: true,
      tasks: [
        {
          id: 'task-foo',
          title: 'Add foo',
          state: 'ready',
          priority: 'p2',
          area: 'client',
          summary: 'Add foo to the surface',
          updatedAt: '2026-04-26T12:00:00.000Z',
          score: 0.91,
        },
        {
          id: 'task-bar',
          title: 'Polish bar',
          state: 'backlog',
          priority: 'p3',
          area: 'core',
          summary: 'Polish bar edges',
          updatedAt: '2026-04-25T18:30:00.000Z',
          score: 0.42,
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().searchTasks('autonomy loop', 10);
    expect(lastCall()[0]).toBe(
      `${baseUrl}/tasks/search?q=autonomy+loop&semantic=true&limit=10`,
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('searchTasks decodes the semantic-unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().searchTasks('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('searchTasks defaults limit to 10', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, tasks: [] }));
    await client().searchTasks('x');
    const url = lastCall()[0] as string;
    expect(url).toContain('limit=10');
  });

  test('searchTasks rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().searchTasks('x')).rejects.toThrow(/mystery/);
  });

  test('searchTasks rejects a malformed task hit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, tasks: [{ id: 'task-foo' }] }),
    );
    await expect(client().searchTasks('x')).rejects.toThrow(/repo task hit/i);
  });

  test('searchTasks surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().searchTasks('x')).rejects.toThrow('503');
  });

  test('recall posts query to /api/recall and decodes the success branch with all four arms', async () => {
    const success = {
      ok: true,
      hits: [
        {
          source: 'knowledge',
          score: 0.91,
          id: 'k-1',
          title: 'Autonomy loop notes',
          preview: 'cross-store recall seam preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'memory',
          score: 0.83,
          id: 'm-1',
          preview: 'remembers the recall fan-out cadence',
          created: '2026-04-25T18:30:00.000Z',
        },
        {
          source: 'history',
          score: 0.71,
          id: 'c-1',
          title: 'Autonomy loop debug',
          cwd: '/Users/x/proj',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
        {
          source: 'tasks',
          score: 0.63,
          id: 'task-foo',
          title: 'Wire mobile recall',
          state: 'ready',
          priority: 'p2',
          updatedAt: '2026-04-24T12:00:00.000Z',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().recall('autonomy loop');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/api/recall`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ query: 'autonomy loop' }));
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(lastHeaders()['Content-Type']).toBe('application/json');
    expect(res).toEqual(success);
  });

  test('recall only sends a filter when at least one option is set', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ ok: true, hits: [] }),
    );
    await client().recall('x', { topK: 5 });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ query: 'x', filter: { topK: 5 } }),
    );

    await client().recall('x', { sources: ['knowledge', 'tasks'] });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({
        query: 'x',
        filter: { sources: ['knowledge', 'tasks'] },
      }),
    );
  });

  test('recall decodes the semantic-unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().recall('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('recall rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().recall('x')).rejects.toThrow(/mystery/);
  });

  test('recall rejects an unknown source loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        hits: [
          { source: 'rumor', score: 0.5, id: 'r-1', title: 'rogue arm' },
        ],
      }),
    );
    await expect(client().recall('x')).rejects.toThrow(/unknown source/i);
  });

  test('recall rejects a malformed knowledge hit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        hits: [{ source: 'knowledge', score: 0.5, id: 'k-1' }],
      }),
    );
    await expect(client().recall('x')).rejects.toThrow(
      /knowledge fields/i,
    );
  });

  test('recall rejects a malformed tasks hit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        hits: [
          {
            source: 'tasks',
            score: 0.5,
            id: 'task-foo',
            title: 'incomplete',
          },
        ],
      }),
    );
    await expect(client().recall('x')).rejects.toThrow(/tasks fields/i);
  });

  test('recall surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().recall('x')).rejects.toThrow('503');
  });

  test('answer posts query to /api/answer and decodes the success branch with citations across two source arms', async () => {
    const success = {
      ok: true,
      answer:
        'Cross-store recall indexes [knowledge:k-1] and [memory:m-1] across the second brain.',
      citations: [
        { source: 'knowledge', id: 'k-1' },
        { source: 'memory', id: 'm-1' },
      ],
      hits: [
        {
          source: 'knowledge',
          score: 0.91,
          id: 'k-1',
          title: 'Cross-store recall fan-out',
          preview: 'preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'memory',
          score: 0.83,
          id: 'm-1',
          preview: 'note about recall design',
          created: '2026-04-25T18:30:00.000Z',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().answer('how does recall fan out');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/api/answer`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({ query: 'how does recall fan out' }),
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(lastHeaders()['Content-Type']).toBe('application/json');
    expect(res).toEqual(success);
  });

  test('answer only sends a filter when at least one option is set', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ ok: false, reason: 'no_hits' }),
    );
    await client().answer('x', { topK: 5 });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ query: 'x', filter: { topK: 5 } }),
    );

    await client().answer('x', { sources: ['knowledge', 'tasks'] });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({
        query: 'x',
        filter: { sources: ['knowledge', 'tasks'] },
      }),
    );
  });

  test('answer decodes the no_hits branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'no_hits' }),
    );
    const res = await client().answer('anything');
    expect(res).toEqual({ ok: false, reason: 'no_hits' });
  });

  test('answer decodes the semantic_unavailable branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'semantic_unavailable' }),
    );
    const res = await client().answer('anything');
    expect(res).toEqual({ ok: false, reason: 'semantic_unavailable' });
  });

  test('answer decodes the synthesis_failed branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'synthesis_failed' }),
    );
    const res = await client().answer('anything');
    expect(res).toEqual({ ok: false, reason: 'synthesis_failed' });
  });

  test('answer rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().answer('x')).rejects.toThrow(/mystery/);
  });

  test('answer rejects a malformed citation loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        answer: 'verbatim',
        citations: [{ source: 'rumor', id: 'r-1' }],
        hits: [],
      }),
    );
    await expect(client().answer('x')).rejects.toThrow(/answer citation/i);
  });

  test('answer rejects a missing answer body loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, citations: [], hits: [] }),
    );
    await expect(client().answer('x')).rejects.toThrow(/answer missing/i);
  });

  test('answer surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().answer('x')).rejects.toThrow('503');
  });

  test('answerLog GETs /api/answers without query params by default and decodes the entries', async () => {
    const success = {
      entries: [
        {
          id: '2026-04-26T12-00-00-000Z-aaa',
          createdAt: '2026-04-26T12:00:00.000Z',
          query: 'how does recall fan out',
          result: { ok: true, citationCount: 2 },
        },
        {
          id: '2026-04-26T11-00-00-000Z-bbb',
          createdAt: '2026-04-26T11:00:00.000Z',
          query: 'a question with no hits',
          result: { ok: false, reason: 'no_hits' },
        },
        {
          id: '2026-04-26T10-00-00-000Z-ccc',
          createdAt: '2026-04-26T10:00:00.000Z',
          query: 'recall unavailable',
          result: { ok: false, reason: 'semantic_unavailable' },
        },
        {
          id: '2026-04-26T09-00-00-000Z-ddd',
          createdAt: '2026-04-26T09:00:00.000Z',
          query: 'synth failure',
          result: { ok: false, reason: 'synthesis_failed' },
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().answerLog();
    expect(lastCall()[0]).toBe(`${baseUrl}/api/answers`);
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('answerLog encodes optional limit and beforeId on the wire', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ entries: [] }));
    await client().answerLog({ limit: 5 });
    expect(lastCall()[0]).toBe(`${baseUrl}/api/answers?limit=5`);
    await client().answerLog({
      beforeId: '2026-04-26T09-00-00-000Z-ddd',
    });
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/answers?beforeId=2026-04-26T09-00-00-000Z-ddd`,
    );
    await client().answerLog({
      limit: 10,
      beforeId: '2026-04-26T09-00-00-000Z-ddd',
    });
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/answers?limit=10&beforeId=2026-04-26T09-00-00-000Z-ddd`,
    );
  });

  test('answerLog rejects an unknown reason on a list entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            id: 'x',
            createdAt: 'y',
            query: 'q',
            result: { ok: false, reason: 'mystery' },
          },
        ],
      }),
    );
    await expect(client().answerLog()).rejects.toThrow(/mystery/);
  });

  test('answerLog rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ entries: [{ id: 'x' }] }),
    );
    await expect(client().answerLog()).rejects.toThrow(
      /answer history entry/i,
    );
  });

  test('answerLog rejects a missing entries field loudly', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    await expect(client().answerLog()).rejects.toThrow(/entries missing/i);
  });

  test('answerLog surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().answerLog()).rejects.toThrow('503');
  });

  test('answerShow GETs /api/answers/:id and decodes the ok-true record', async () => {
    const success = {
      ok: true,
      record: {
        id: '2026-04-26T12-00-00-000Z-aaa',
        createdAt: '2026-04-26T12:00:00.000Z',
        query: 'how does recall fan out',
        filter: { topK: 5 },
        recallHits: [
          {
            source: 'knowledge',
            score: 0.91,
            id: 'k-1',
            title: 'Cross-store recall fan-out',
            preview: 'preview',
            updated: '2026-04-26T12:00:00.000Z',
          },
        ],
        result: {
          ok: true,
          answer:
            'Cross-store recall indexes [knowledge:k-1] and [memory:m-1] across the second brain.',
          citations: [
            { source: 'knowledge', id: 'k-1' },
            { source: 'memory', id: 'm-1' },
          ],
          hits: [
            {
              source: 'knowledge',
              score: 0.91,
              id: 'k-1',
              title: 'Cross-store recall fan-out',
              preview: 'preview',
              updated: '2026-04-26T12:00:00.000Z',
            },
            {
              source: 'memory',
              score: 0.83,
              id: 'm-1',
              preview: 'note about recall design',
              created: '2026-04-25T18:30:00.000Z',
            },
          ],
        },
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(success));
    const res = await client().answerShow('2026-04-26T12-00-00-000Z-aaa');
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/answers/2026-04-26T12-00-00-000Z-aaa`,
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(success);
  });

  test('answerShow decodes the not_found arm verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'not_found' }),
    );
    const res = await client().answerShow('missing');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  test('answerShow rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().answerShow('x')).rejects.toThrow(/mystery/);
  });

  test('answerShow rejects a malformed record (bad embedded result) loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          id: 'x',
          createdAt: 'y',
          query: 'q',
          filter: {},
          recallHits: [],
          result: { ok: false, reason: 'mystery' },
        },
      }),
    );
    await expect(client().answerShow('x')).rejects.toThrow(/mystery/);
  });

  test('answerShow rejects a malformed embedded recallHit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          id: 'x',
          createdAt: 'y',
          query: 'q',
          filter: {},
          recallHits: [{ source: 'knowledge', score: 0.5, id: 'k-1' }],
          result: { ok: false, reason: 'no_hits' },
        },
      }),
    );
    await expect(client().answerShow('x')).rejects.toThrow(/knowledge fields/i);
  });

  test('answerShow rejects a missing ok flag loudly', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ record: null }));
    await expect(client().answerShow('x')).rejects.toThrow(/missing ok flag/i);
  });

  test('answerShow surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().answerShow('x')).rejects.toThrow('503');
  });

  test('answerShow encodes the id one-to-one when it contains url-significant characters', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'not_found' }),
    );
    await client().answerShow('id with/space');
    expect(lastCall()[0]).toBe(
      `${baseUrl}/api/answers/id%20with%2Fspace`,
    );
  });

  test('capture posts text to /api/capture and decodes the success branch across record arms', async () => {
    const tasksSuccess = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-buy-milk',
        path: 'data/tasks/ready/task-buy-milk.md',
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(tasksSuccess));
    const tasksRes = await client().capture('buy milk', {
      target: 'tasks',
      hint: 'shopping',
    });
    const [tasksUrl, tasksInit] = lastCall();
    expect(tasksUrl).toBe(`${baseUrl}/api/capture`);
    expect(tasksInit?.method).toBe('POST');
    expect(tasksInit?.body).toBe(
      JSON.stringify({
        text: 'buy milk',
        filter: { target: 'tasks', hint: 'shopping' },
      }),
    );
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(lastHeaders()['Content-Type']).toBe('application/json');
    expect(tasksRes).toEqual(tasksSuccess);

    const memorySuccess = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-42' },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(memorySuccess));
    const memoryRes = await client().capture('remember the milk');
    const memoryInit = lastCall()[1];
    expect(memoryInit?.body).toBe(
      JSON.stringify({ text: 'remember the milk' }),
    );
    expect(memoryRes).toEqual(memorySuccess);
  });

  test('capture only sends a filter when at least one option is set', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ ok: false, reason: 'no_contributors' }),
    );

    await client().capture('x');
    expect(lastCall()[1]?.body).toBe(JSON.stringify({ text: 'x' }));

    await client().capture('x', { target: 'inbox' });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ text: 'x', filter: { target: 'inbox' } }),
    );

    await client().capture('x', { hint: 'misc' });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({ text: 'x', filter: { hint: 'misc' } }),
    );
  });

  test('capture decodes the ambiguous branch preserving suggestion order', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'ambiguous',
        suggestions: ['knowledge', 'memory'],
      }),
    );
    const res = await client().capture('a fact about a place');
    expect(res).toEqual({
      ok: false,
      reason: 'ambiguous',
      suggestions: ['knowledge', 'memory'],
    });
  });

  test('capture decodes the no_contributors branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'no_contributors' }),
    );
    const res = await client().capture('anything');
    expect(res).toEqual({ ok: false, reason: 'no_contributors' });
  });

  test('capture decodes the contributor_failed branch with target and message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'contributor_failed',
        target: 'inbox',
        message: 'inbox writer cannot reach project root',
      }),
    );
    const res = await client().capture('boom');
    expect(res).toEqual({
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach project root',
    });
  });

  test('capture rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().capture('x')).rejects.toThrow(/mystery/);
  });

  test('capture rejects a malformed record loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: { target: 'tasks', recordId: 'task-foo' },
      }),
    );
    await expect(client().capture('x')).rejects.toThrow(/tasks path/i);
  });

  test('capture rejects an unknown target on a success record loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: { target: 'rumor', recordId: 'r-1' },
      }),
    );
    await expect(client().capture('x')).rejects.toThrow(/unknown target/i);
  });

  test('capture rejects an unknown contributor_failed target loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'contributor_failed',
        target: 'rumor',
        message: 'boom',
      }),
    );
    await expect(client().capture('x')).rejects.toThrow(/unknown target/i);
  });

  test('capture surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().capture('x')).rejects.toThrow('503');
  });

  test('health hits /health without auth header (public endpoint)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 'ok', version: '1', uptimeMs: 1, components: {} }));
    await client().health();
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/health`);
    expect(init).toBeUndefined();
  });

  test('sseUrl builds /events with optional since', () => {
    const c = client();
    expect(c.sseUrl()).toBe(`${baseUrl}/events`);
    expect(c.sseUrl('2026-01-01T00:00:00Z')).toBe(
      `${baseUrl}/events?since=2026-01-01T00%3A00%3A00Z`,
    );
  });

  test('chatUrl encodes session id', () => {
    expect(client().chatUrl('sess/1')).toBe(`${baseUrl}/sessions/sess%2F1/chat`);
  });

  test('authHeader is a bearer token header', () => {
    expect(client().authHeader).toBe(`Bearer ${token}`);
  });
});

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

  test('retract posts the typed memory arm to /api/retract and decodes the success branch', async () => {
    const memorySuccess = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(memorySuccess));
    const res = await client().retract({ target: 'memory', id: 'mem-7' });
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/api/retract`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ target: 'memory', id: 'mem-7' }));
    expect(lastHeaders().Authorization).toBe(`Bearer ${token}`);
    expect(res).toEqual(memorySuccess);
  });

  test('retract decodes the tasks success arm with previousPath/path/toState', async () => {
    const tasksSuccess = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-foo',
        previousPath: 'data/tasks/ready/task-foo.md',
        path: 'data/tasks/dropped/task-foo.md',
        toState: 'dropped',
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(tasksSuccess));
    const res = await client().retract({ target: 'tasks', id: 'task-foo' });
    expect(res).toEqual(tasksSuccess);
  });

  test('retract decodes the inbox success arm with the unlinked path', async () => {
    const inboxSuccess = {
      ok: true,
      record: {
        target: 'inbox',
        recordId: 'inbox-1',
        path: 'data/inbox/note-foo.md',
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(inboxSuccess));
    const res = await client().retract({
      target: 'inbox',
      path: 'data/inbox/note-foo.md',
    });
    expect(lastCall()[1]?.body).toBe(
      JSON.stringify({
        target: 'inbox',
        path: 'data/inbox/note-foo.md',
      }),
    );
    expect(res).toEqual(inboxSuccess);
  });

  test('retract decodes the no_contributors branch verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'no_contributors' }),
    );
    const res = await client().retract({
      target: 'knowledge',
      slug: 'autonomy-loop',
    });
    expect(res).toEqual({ ok: false, reason: 'no_contributors' });
  });

  test('retract decodes the not_found branch with target and submitted identifier', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'not_found',
        target: 'memory',
        identifier: 'mem-missing',
      }),
    );
    const res = await client().retract({ target: 'memory', id: 'mem-missing' });
    expect(res).toEqual({
      ok: false,
      reason: 'not_found',
      target: 'memory',
      identifier: 'mem-missing',
    });
  });

  test('retract decodes the contributor_failed branch with target and message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'contributor_failed',
        target: 'inbox',
        message: 'inbox writer cannot reach scope root',
      }),
    );
    const res = await client().retract({
      target: 'inbox',
      path: 'data/inbox/note-foo.md',
    });
    expect(res).toEqual({
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach scope root',
    });
  });

  test('retract rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(
      client().retract({ target: 'memory', id: 'mem-7' }),
    ).rejects.toThrow(/mystery/);
  });

  test('retract rejects an unknown target on a success record loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: { target: 'rumor', recordId: 'r-1' },
      }),
    );
    await expect(
      client().retract({ target: 'memory', id: 'mem-7' }),
    ).rejects.toThrow(/unknown target/i);
  });

  test('retract rejects a tasks success record missing previousPath loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          target: 'tasks',
          recordId: 'task-foo',
          path: 'data/tasks/dropped/task-foo.md',
          toState: 'dropped',
        },
      }),
    );
    await expect(
      client().retract({ target: 'tasks', id: 'task-foo' }),
    ).rejects.toThrow(/previousPath/i);
  });

  test('retract rejects a tasks success record with a non-dropped toState loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          target: 'tasks',
          recordId: 'task-foo',
          previousPath: 'data/tasks/ready/task-foo.md',
          path: 'data/tasks/done/task-foo.md',
          toState: 'done',
        },
      }),
    );
    await expect(
      client().retract({ target: 'tasks', id: 'task-foo' }),
    ).rejects.toThrow(/toState/i);
  });

  test('retract rejects a not_found target outside the closed enum loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: false,
        reason: 'not_found',
        target: 'rumor',
        identifier: 'mem-missing',
      }),
    );
    await expect(
      client().retract({ target: 'memory', id: 'mem-missing' }),
    ).rejects.toThrow(/unknown target/i);
  });

  test('retract surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(
      client().retract({ target: 'memory', id: 'mem-7' }),
    ).rejects.toThrow('503');
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
  });});

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
    await expect(client().searchHistory('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('searchHistory rejects a malformed conversation loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, conversations: [{ id: 'c-1' }] }),
    );
    await expect(client().searchHistory('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
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
          state: 'open',
          priority: 'p2',
          score: 0.91,
        },
        {
          id: 'task-bar',
          title: 'Polish bar',
          state: 'open',
          priority: 'p3',
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
    await expect(client().searchTasks('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('searchTasks rejects a malformed task hit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, tasks: [{ id: 'task-foo' }] }),
    );
    await expect(client().searchTasks('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
          state: 'open',
          priority: 'p2',
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
    await expect(client().recall('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().recall('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });});

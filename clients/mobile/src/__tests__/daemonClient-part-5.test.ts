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
            'Cross-store recall indexes [knowledge:k-1] and [memory:m-1] across knowledge and memory.',
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
    await expect(client().answerShow('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().answerShow('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().answerShow('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('answerShow rejects a missing ok flag loudly', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ record: null }));
    await expect(client().answerShow('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
        path: 'data/tasks/task-buy-milk.md',
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
        message: 'inbox writer cannot reach scope root',
      }),
    );
    const res = await client().capture('boom');
    expect(res).toEqual({
      ok: false,
      reason: 'contributor_failed',
      target: 'inbox',
      message: 'inbox writer cannot reach scope root',
    });
  });

  test('capture rejects an unknown reason loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: false, reason: 'mystery' }),
    );
    await expect(client().capture('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('capture rejects a malformed record loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: { target: 'tasks', recordId: 'task-foo' },
      }),
    );
    await expect(client().capture('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });});

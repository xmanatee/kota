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

  test('recall rejects a malformed knowledge hit loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        hits: [{ source: 'knowledge', score: 0.5, id: 'k-1' }],
      }),
    );
    await expect(client().recall('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
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
    await expect(client().recall('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().answer('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().answer('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('answer rejects a missing answer body loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, citations: [], hits: [] }),
    );
    await expect(client().answer('x')).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
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
    await expect(client().answerLog()).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('answerLog rejects a malformed entry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ entries: [{ id: 'x' }] }),
    );
    await expect(client().answerLog()).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('answerLog rejects a missing entries field loudly', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    await expect(client().answerLog()).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });

  test('answerLog surfaces the daemon HTTP error one-to-one', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(client().answerLog()).rejects.toThrow('503');
  });});

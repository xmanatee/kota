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

  test('createSession posts to /sessions', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ session_id: 'sess' }));
    const res = await client().createSession();
    expect(lastCall()[0]).toBe(`${baseUrl}/sessions`);
    expect(lastCall()[1]?.method).toBe('POST');
    expect(res.session_id).toBe('sess');
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

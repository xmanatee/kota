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
    await client().approve('a1', 'a'.repeat(64), 'looks good');

    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/approvals/a1/approve`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({
      reviewDigest: 'a'.repeat(64),
      note: 'looks good',
    }));
  });

  test('approve without note still submits the reviewed digest', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ approval: {} }));
    await client().approve('a1', 'a'.repeat(64));
    const init = lastCall()[1];
    expect(init?.body).toBe(JSON.stringify({
      reviewDigest: 'a'.repeat(64),
    }));
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

  test('scope-scoped routes append ?scopeId=<id> when provided', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ runs: [], sessions: [], running: true, pid: 1, startedAt: 't', completedRuns: 0, workflow: {} }),
    );
    const c = client();
    await c.getStatus('p-other');
    expect(lastCall()[0]).toBe(`${baseUrl}/status?scopeId=p-other`);

    await c.getRuns(undefined, 30, 'p-other');
    expect(lastCall()[0]).toBe(
      `${baseUrl}/workflow/runs?limit=30&scopeId=p-other`,
    );

    await c.getSessions('p-other');
    expect(lastCall()[0]).toBe(`${baseUrl}/sessions?scopeId=p-other`);

    fetchSpy.mockResolvedValueOnce(jsonResponse({ session_id: 's' }));
    await c.createSession(undefined, 'p-other');
    expect(lastCall()[0]).toBe(`${baseUrl}/sessions?scopeId=p-other`);

    await c.getRunDetail('run-1', 'p-other');
    expect(lastCall()[0]).toBe(
      `${baseUrl}/workflow/runs/run-1?scopeId=p-other`,
    );
  });

  test('scoped routes omit ?scopeId= when no id is supplied', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ running: true, pid: 1, startedAt: 't', completedRuns: 0, workflow: {} }),
    );
    await client().getStatus();
    expect(lastCall()[0]).toBe(`${baseUrl}/status`);
  });

  test('getIdentity decodes the scope registry projection through the conformance parser', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        scopeName: 'kota',
        scopeRoot: '/tmp/kota',
        daemonVersion: '0.1.0',
        pid: 1,
        startedAt: 't',
        dashboard: { available: true, path: '/' },
        scopeRegistry: {
          rootScopeId: 'global',
          defaultScopeId: 'p-default',
          scopes: [
            { scopeId: 'global', displayName: 'Global' },
            { scopeId: 'p-default', directoryRoot: '/tmp/kota', displayName: 'kota', parentScopeId: 'global' },
            { scopeId: 'p-other', directoryRoot: '/tmp/other', displayName: 'other', parentScopeId: 'global' },
          ],
        },
      }),
    );
    const id = await client().getIdentity();
    expect(id.scopeRegistry.defaultScopeId).toBe('p-default');
    expect(id.scopeRegistry.scopes.map((scope) => scope.scopeId)).toEqual([
      'global',
      'p-default',
      'p-other',
    ]);
  });

  test('getIdentity rejects an empty scope registry loudly', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        scopeName: 'kota',
        scopeRoot: '/tmp/kota',
        daemonVersion: '0.1.0',
        pid: 1,
        startedAt: 't',
        scopeRegistry: { rootScopeId: 'global', defaultScopeId: 'p-x', scopes: [] },
      }),
    );
    await expect(client().getIdentity()).rejects.toThrow();
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
  });});

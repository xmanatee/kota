import { DaemonClient } from '../daemonClient';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DaemonClient transport extensions', () => {
  const baseUrl = 'http://127.0.0.1:8765';
  const token = 'test-token';
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  function client() {
    return new DaemonClient(baseUrl, token);
  }

  function lastCall(): FetchArgs {
    return fetchSpy.mock.calls.at(-1) as FetchArgs;
  }

  test('push registration uses the authenticated transport', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().registerPushToken('device-1', 'push-token');

    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/push-tokens`);
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ deviceId: 'device-1', token: 'push-token' }),
    });
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  test('session deletion treats an absent session as deleted', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(client().deleteSession('gone')).resolves.toBeUndefined();
  });

  test('session deletion surfaces other transport failures', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(client().deleteSession('broken')).rejects.toThrow('500');
  });

  test('session URLs encode external identifiers and cursors', () => {
    const daemon = client();
    expect(daemon.chatUrl('session/one')).toBe(
      `${baseUrl}/sessions/session%2Fone/chat`,
    );
    expect(daemon.sseUrl('event/one')).toBe(
      `${baseUrl}/events?since=event%2Fone`,
    );
    expect(daemon.authHeader).toBe(`Bearer ${token}`);
  });
});

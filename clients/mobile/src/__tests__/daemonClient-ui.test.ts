import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { DaemonClient } from '../daemonClient';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import { parseUiDaemonRouteDocument } from '../daemon/ui';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DaemonClient shared UI', () => {
  const bundle = parseUiSurfaceBundle(fixture.operatorBundle);
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  test('loads and strictly decodes the generated bundle for the active scope', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(fixture.operatorBundle));
    const client = new DaemonClient('http://127.0.0.1:8765', 'token');
    const result = await client.getUiSurfaces('scope one');
    expect(result.protocolVersion).toBe('ui.surface.v1');
    expect(result.surfaces.length).toBeGreaterThan(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8765/ui/surfaces?scopeId=scope%20one',
    );
  });

  test('executes a graph action through the single shared endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, message: 'Queued.' }));
    const client = new DaemonClient('http://127.0.0.1:8765', 'token');
    const action = bundle.surfaces[0]!.actions[0]!;
    await expect(client.executeUiAction(action, { explain: true })).resolves.toEqual({
      ok: true,
      message: 'Queued.',
    });
    const [, init] = fetchSpy.mock.calls[0] as FetchArgs;
    expect(init?.body).toBe(
      JSON.stringify({
        scopeId: action.scopeId,
        surfaceId: action.surfaceId,
        actionId: action.actionId,
        parameters: { explain: true },
      }),
    );
  });

  test('loads daemon-route links with the client bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 'ready' }));
    const client = new DaemonClient(
      'http://127.0.0.1:8765',
      'authenticated-mobile-token',
    );

    await expect(client.getUiDaemonRoute('/status')).resolves.toEqual({
      status: 'ready',
    });

    const [input, init] = fetchSpy.mock.calls[0] as FetchArgs;
    expect(input).toBe('http://127.0.0.1:8765/status');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer authenticated-mobile-token',
    });
  });

  test('rejects malformed daemon-route paths and non-JSON values', async () => {
    const client = new DaemonClient('http://127.0.0.1:8765', 'token');
    await expect(client.getUiDaemonRoute('status')).rejects.toThrow(
      /path must start with/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(() => parseUiDaemonRouteDocument({ value: undefined })).toThrow(
      /expected JSON/i,
    );
  });

  test('rejects an unknown action result arm', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'missing-message' }));
    const client = new DaemonClient('http://127.0.0.1:8765', 'token');
    const action = bundle.surfaces[0]!.actions[0]!;
    await expect(client.executeUiAction(action)).rejects.toThrow(/unknown result arm/i);
  });
});

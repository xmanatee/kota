import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { DaemonClient } from '../daemonClient';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import { parseUiDaemonRouteDocument } from '../daemon/ui';

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

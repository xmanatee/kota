/**
 * Voice client tests for the mobile DaemonClient — round-trip and failure
 * mode for both /voice directions, mirroring the codes the daemon documents
 * (`stt-unavailable`, `tts-format-unsupported`). The mobile client must
 * surface these one-to-one so operators learn the same vocabulary the CLI
 * and web client use.
 */

import { DaemonClient } from '../daemonClient';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DaemonClient voice', () => {
  const baseUrl = 'http://127.0.0.1:8765';
  const token = 'test-token';
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}));
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

  test('voiceTranscribe POSTs base64 audio and parses success', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ text: 'hello mobile', language: 'en' }));

    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await client().voiceTranscribe({
      audio,
      mimeType: 'audio/m4a',
      filename: 'clip.m4a',
    });

    expect(result).toEqual({ ok: true, text: 'hello mobile', language: 'en' });
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/voice/transcribe`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.mimeType).toBe('audio/m4a');
    expect(body.filename).toBe('clip.m4a');
    // base64 of [1,2,3,4,5] is AQIDBAU=
    expect(body.audioBase64).toBe('AQIDBAU=');
  });

  test('voiceTranscribe surfaces stt-unavailable on 503', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'No transcription provider is registered',
          code: 'stt-unavailable',
        },
        503,
      ),
    );

    const result = await client().voiceTranscribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/m4a',
    });

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'No transcription provider is registered',
      code: 'stt-unavailable',
    });
  });

  test('voiceSynthesize decodes returned audio bytes', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        // base64 of [9,8,7,6] is CQgHBg==
        audioBase64: 'CQgHBg==',
        mimeType: 'audio/mpeg',
        format: 'mp3',
      }),
    );

    const result = await client().voiceSynthesize({ text: 'speak me' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(Array.from(result.audio)).toEqual([9, 8, 7, 6]);
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.format).toBe('mp3');
    const [url, init] = lastCall();
    expect(url).toBe(`${baseUrl}/voice/synthesize`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'speak me' });
  });

  test('voiceSynthesize surfaces tts-format-unsupported with supported list', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'Format flac not supported by provider',
          code: 'tts-format-unsupported',
          supported: ['mp3', 'wav'],
        },
        400,
      ),
    );

    const result = await client().voiceSynthesize({ text: 'x', format: 'flac' });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Format flac not supported by provider',
      code: 'tts-format-unsupported',
      supported: ['mp3', 'wav'],
    });
  });
});

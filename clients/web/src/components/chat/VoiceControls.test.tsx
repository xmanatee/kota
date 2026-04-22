/**
 * VoiceControls integration test — exercises the UI through the same
 * /api/voice surface the daemon module exposes, asserting:
 *
 *  - microphone capture → /api/voice/transcribe → onTranscript carries text
 *  - failed STT → onError carries the typed daemon code (`stt-unavailable`)
 *  - successful TTS → audio.play is invoked with a synthesized Blob URL
 *
 * MediaRecorder, getUserMedia, and HTMLAudioElement are stubbed because
 * jsdom does not provide them. The stubs match the real API surface
 * shapes we use in production code paths.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "./VoiceControls";

class StubMediaRecorder {
  static lastInstance: StubMediaRecorder | null = null;
  static instances: StubMediaRecorder[] = [];
  public mimeType: string;
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  constructor(
    public stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    StubMediaRecorder.lastInstance = this;
    StubMediaRecorder.instances.push(this);
  }

  static isTypeSupported(_type: string): boolean {
    return true;
  }

  addEventListener(name: string, handler: (ev: unknown) => void): void {
    const arr = this.listeners.get(name) ?? [];
    arr.push(handler);
    this.listeners.set(name, arr);
  }

  start(): void {}

  stop(): void {
    const dataHandlers = this.listeners.get("dataavailable") ?? [];
    for (const handler of dataHandlers) {
      handler({
        data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
      });
    }
    const stopHandlers = this.listeners.get("stop") ?? [];
    for (const handler of stopHandlers) {
      handler({});
    }
  }
}

function makeStream(): MediaStream {
  const tracks: { stop: () => void }[] = [{ stop: vi.fn() }];
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function makeMediaDevices(
  stream: MediaStream,
): Pick<MediaDevices, "getUserMedia"> {
  return {
    getUserMedia: vi.fn().mockResolvedValue(stream),
  };
}

describe("VoiceControls", () => {
  const originalFetch = globalThis.fetch;
  let originalAudio: typeof window.Audio;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    StubMediaRecorder.lastInstance = null;
    StubMediaRecorder.instances = [];
    globalThis.fetch = vi.fn();
    originalAudio = window.Audio;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.Audio = originalAudio;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.resetModules();
  });

  it("captures, uploads, and forwards a transcript on the happy path", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "hello kota", language: "en" }),
    });

    const stream = makeStream();
    const onTranscript = vi.fn();
    const onError = vi.fn();

    render(
      <VoiceControls
        speakableText={null}
        onTranscript={onTranscript}
        onError={onError}
        mediaDevices={makeMediaDevices(stream)}
        mediaRecorderCtor={StubMediaRecorder as unknown as typeof MediaRecorder}
      />,
    );

    const recordButton = screen.getByRole("button", { name: /record voice/i });
    await act(async () => {
      fireEvent.click(recordButton);
    });

    await waitFor(() => expect(StubMediaRecorder.lastInstance).not.toBeNull());

    const stopButton = screen.getByRole("button", { name: /stop recording/i });
    await act(async () => {
      fireEvent.click(stopButton);
    });

    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("hello kota"),
    );
    expect(onError).not.toHaveBeenCalled();

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/voice/transcribe");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.mimeType).toMatch(/^audio\/webm/);
    // base64 of [1,2,3]
    expect(body.audioBase64).toBe("AQID");
  });

  it("surfaces stt-unavailable from the daemon as a typed onError", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          error: "No transcription provider is registered",
          code: "stt-unavailable",
        }),
    });

    const stream = makeStream();
    const onTranscript = vi.fn();
    const onError = vi.fn();

    render(
      <VoiceControls
        speakableText={null}
        onTranscript={onTranscript}
        onError={onError}
        mediaDevices={makeMediaDevices(stream)}
        mediaRecorderCtor={StubMediaRecorder as unknown as typeof MediaRecorder}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /record voice/i }));
    });
    await waitFor(() => expect(StubMediaRecorder.lastInstance).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
    });

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        code: "stt-unavailable",
        message: "No transcription provider is registered",
      }),
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("synthesizes the latest assistant text and plays it back", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          audioBase64: "CQgHBg==",
          mimeType: "audio/mpeg",
          format: "mp3",
        }),
    });

    const playSpy = vi.fn().mockResolvedValue(undefined);
    const audioListeners = new Map<string, Array<() => void>>();
    const stubAudio = {
      addEventListener: (name: string, handler: () => void) => {
        const arr = audioListeners.get(name) ?? [];
        arr.push(handler);
        audioListeners.set(name, arr);
      },
      play: playSpy,
      pause: vi.fn(),
      src: "",
    };
    window.Audio = vi
      .fn()
      .mockReturnValue(stubAudio) as unknown as typeof window.Audio;

    const onError = vi.fn();
    render(
      <VoiceControls
        speakableText="latest reply"
        onTranscript={vi.fn()}
        onError={onError}
      />,
    );

    const speakButton = screen.getByRole("button", {
      name: /speak latest reply/i,
    });
    await act(async () => {
      fireEvent.click(speakButton);
    });

    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    expect(window.Audio).toHaveBeenCalledWith("blob:test");
    expect(onError).not.toHaveBeenCalled();

    // simulate playback finishing
    act(() => {
      const handlers = audioListeners.get("ended") ?? [];
      for (const h of handlers) h();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

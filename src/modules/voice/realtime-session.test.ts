import { describe, expect, it } from "vitest";
import {
  applyRealtimeVoiceSessionEvent,
  createRealtimeVoiceProviderFailedEvent,
  createRealtimeVoiceProviderUnavailableEvent,
  createRealtimeVoiceSessionState,
  type RealtimeVoiceAudioChunk,
  type RealtimeVoiceChannelIdentity,
  type RealtimeVoiceSessionActiveState,
  type RealtimeVoiceSessionCompletedState,
  type RealtimeVoiceSessionErroredState,
  type RealtimeVoiceSessionEvent,
  type RealtimeVoiceSessionState,
  RealtimeVoiceSessionTransitionError,
} from "./index.js";

const SESSION_ID = "session-voice-1";

const CHANNEL_IDENTITY: RealtimeVoiceChannelIdentity = {
  channel: "test-channel",
  channelUserId: "operator-1",
  displayName: "Test Operator",
};

type RealtimeVoiceEventWithoutTurn =
  RealtimeVoiceSessionEvent extends infer Event
    ? Event extends RealtimeVoiceSessionEvent
      ? Omit<Event, "sessionId" | "turnId">
      : never
    : never;

function audioChunk(id: string): RealtimeVoiceAudioChunk {
  return {
    chunkId: id,
    audio: new Uint8Array([1, 2, 3]),
    mimeType: "audio/pcm",
  };
}

function startEvent(turnId: string): RealtimeVoiceSessionEvent {
  return {
    type: "realtime-voice.session-started",
    sessionId: SESSION_ID,
    turnId,
    channelIdentity: CHANNEL_IDENTITY,
  };
}

function event(
  turnId: string,
  event: RealtimeVoiceEventWithoutTurn,
): RealtimeVoiceSessionEvent {
  return {
    ...event,
    sessionId: SESSION_ID,
    turnId,
  } as RealtimeVoiceSessionEvent;
}

function activeTurn(turnId: string, maxInputAudioChunks = 128): RealtimeVoiceSessionActiveState {
  const state = applyRealtimeVoiceSessionEvent(
    createRealtimeVoiceSessionState({ maxInputAudioChunks }),
    startEvent(turnId),
  );
  return expectActive(state);
}

function expectActive(state: RealtimeVoiceSessionState): RealtimeVoiceSessionActiveState {
  expect(state.status).toBe("active");
  if (state.status !== "active") throw new Error(`Expected active state, got ${state.status}`);
  return state;
}

function expectCompleted(state: RealtimeVoiceSessionState): RealtimeVoiceSessionCompletedState {
  expect(state.status).toBe("completed");
  if (state.status !== "completed") {
    throw new Error(`Expected completed state, got ${state.status}`);
  }
  return state;
}

function expectErrored(state: RealtimeVoiceSessionState): RealtimeVoiceSessionErroredState {
  expect(state.status).toBe("errored");
  if (state.status !== "errored") throw new Error(`Expected errored state, got ${state.status}`);
  return state;
}

describe("realtime voice session protocol", () => {
  it("records a successful realtime turn with session and channel identity", () => {
    const turnId = "turn-success";
    let state: RealtimeVoiceSessionState = createRealtimeVoiceSessionState();

    state = applyRealtimeVoiceSessionEvent(state, startEvent(turnId));
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.input-audio-chunk",
        chunk: audioChunk("input-1"),
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.partial-transcript",
        text: "hel",
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.final-transcript",
        text: "hello",
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.assistant-text",
        text: "hi back",
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.assistant-audio-chunk",
        chunk: audioChunk("assistant-1"),
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.session-completed",
        reason: "turn-complete",
      }),
    );

    const completed = expectCompleted(state);
    expect(completed.sessionId).toBe(SESSION_ID);
    expect(completed.channelIdentity).toEqual(CHANNEL_IDENTITY);
    expect(completed.inputAudioChunks).toBe(1);
    expect(completed.timeline.map((item) => item.type)).toEqual([
      "realtime-voice.session-started",
      "realtime-voice.input-audio-chunk",
      "realtime-voice.partial-transcript",
      "realtime-voice.final-transcript",
      "realtime-voice.assistant-text",
      "realtime-voice.assistant-audio-chunk",
      "realtime-voice.session-completed",
    ]);
  });

  it("records an interrupted turn as a closed turn with a reconstructible timeline", () => {
    const turnId = "turn-interrupted";
    let state: RealtimeVoiceSessionState = activeTurn(turnId);

    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.input-audio-chunk",
        chunk: audioChunk("input-1"),
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.partial-transcript",
        text: "stop",
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.turn-interrupted",
        reason: "barge-in",
      }),
    );
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.session-completed",
        reason: "interrupted",
      }),
    );

    const completed = expectCompleted(state);
    expect(completed.reason).toBe("interrupted");
    expect(completed.timeline.map((item) => item.type)).toEqual([
      "realtime-voice.session-started",
      "realtime-voice.input-audio-chunk",
      "realtime-voice.partial-transcript",
      "realtime-voice.turn-interrupted",
      "realtime-voice.session-completed",
    ]);
  });

  it("rejects malformed event order loudly", () => {
    const turnId = "turn-invalid";
    expect(() =>
      applyRealtimeVoiceSessionEvent(
        createRealtimeVoiceSessionState(),
        event(turnId, {
          type: "realtime-voice.final-transcript",
          text: "too early",
        }),
      ),
    ).toThrow(RealtimeVoiceSessionTransitionError);

    let state: RealtimeVoiceSessionState = activeTurn(turnId);
    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.turn-interrupted",
        reason: "user-cancelled",
      }),
    );
    expect(() =>
      applyRealtimeVoiceSessionEvent(
        state,
        event(turnId, {
          type: "realtime-voice.turn-interrupted",
          reason: "barge-in",
        }),
      ),
    ).toThrow(RealtimeVoiceSessionTransitionError);

    state = applyRealtimeVoiceSessionEvent(
      state,
      event(turnId, {
        type: "realtime-voice.session-completed",
        reason: "interrupted",
      }),
    );
    expect(() =>
      applyRealtimeVoiceSessionEvent(
        state,
        event(turnId, {
          type: "realtime-voice.input-audio-chunk",
          chunk: audioChunk("late-input"),
        }),
      ),
    ).toThrow(RealtimeVoiceSessionTransitionError);
    expect(() =>
      applyRealtimeVoiceSessionEvent(
        state,
        event(turnId, {
          type: "realtime-voice.session-completed",
          reason: "turn-complete",
        }),
      ),
    ).toThrow(RealtimeVoiceSessionTransitionError);
  });

  it("maps provider and chunk-budget failures to typed terminal error events", () => {
    const providerCodes = [
      createRealtimeVoiceProviderUnavailableEvent(activeTurn("stt-unavailable"), "stt", "no STT"),
      createRealtimeVoiceProviderUnavailableEvent(activeTurn("tts-unavailable"), "tts", "no TTS"),
      createRealtimeVoiceProviderFailedEvent(activeTurn("stt-failed"), "stt", "STT failed"),
      createRealtimeVoiceProviderFailedEvent(activeTurn("tts-failed"), "tts", "TTS failed"),
    ].map((item) => item.code);
    expect(providerCodes).toEqual([
      "stt-unavailable",
      "tts-unavailable",
      "stt-failed",
      "tts-failed",
    ]);

    const active = activeTurn("provider-terminal");
    const providerErrored = applyRealtimeVoiceSessionEvent(
      active,
      createRealtimeVoiceProviderUnavailableEvent(active, "stt", "No STT provider"),
    );
    expect(expectErrored(providerErrored).code).toBe("stt-unavailable");

    let chunkState: RealtimeVoiceSessionState = activeTurn("chunk-budget", 1);
    chunkState = applyRealtimeVoiceSessionEvent(
      chunkState,
      event("chunk-budget", {
        type: "realtime-voice.input-audio-chunk",
        chunk: audioChunk("input-1"),
      }),
    );
    chunkState = applyRealtimeVoiceSessionEvent(
      chunkState,
      event("chunk-budget", {
        type: "realtime-voice.input-audio-chunk",
        chunk: audioChunk("input-2"),
      }),
    );

    const budgetErrored = expectErrored(chunkState);
    expect(budgetErrored.code).toBe("chunk-budget-exceeded");
    expect(budgetErrored.timeline.at(-1)).toMatchObject({
      type: "realtime-voice.session-error",
      code: "chunk-budget-exceeded",
    });
  });
});

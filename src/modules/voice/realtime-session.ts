import type { ChannelUserIdentity } from "#core/channels/channel.js";

export type RealtimeVoiceChannelIdentity = ChannelUserIdentity;

export type RealtimeVoiceAudioChunk = {
  chunkId: string;
  audio: Uint8Array;
  mimeType: string;
};

type RealtimeVoiceEventBase = {
  sessionId: string;
  turnId: string;
};

export type RealtimeVoiceSessionStartedEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.session-started";
  channelIdentity: RealtimeVoiceChannelIdentity;
};

export type RealtimeVoiceInputAudioChunkEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.input-audio-chunk";
  chunk: RealtimeVoiceAudioChunk;
};

export type RealtimeVoicePartialTranscriptEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.partial-transcript";
  text: string;
};

export type RealtimeVoiceFinalTranscriptEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.final-transcript";
  text: string;
};

export type RealtimeVoiceAssistantTextEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.assistant-text";
  text: string;
};

export type RealtimeVoiceAssistantAudioChunkEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.assistant-audio-chunk";
  chunk: RealtimeVoiceAudioChunk;
};

export type RealtimeVoiceInterruptionEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.turn-interrupted";
  reason: "user-cancelled" | "barge-in";
};

export type RealtimeVoiceCompletionEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.session-completed";
  reason: "turn-complete" | "interrupted";
};

export type RealtimeVoiceTerminalErrorCode =
  | "stt-unavailable"
  | "tts-unavailable"
  | "stt-failed"
  | "tts-failed"
  | "chunk-budget-exceeded";

export type RealtimeVoiceTerminalErrorEvent = RealtimeVoiceEventBase & {
  type: "realtime-voice.session-error";
  code: RealtimeVoiceTerminalErrorCode;
  message: string;
};

export type RealtimeVoiceSessionEvent =
  | RealtimeVoiceSessionStartedEvent
  | RealtimeVoiceInputAudioChunkEvent
  | RealtimeVoicePartialTranscriptEvent
  | RealtimeVoiceFinalTranscriptEvent
  | RealtimeVoiceAssistantTextEvent
  | RealtimeVoiceAssistantAudioChunkEvent
  | RealtimeVoiceInterruptionEvent
  | RealtimeVoiceCompletionEvent
  | RealtimeVoiceTerminalErrorEvent;

export type RealtimeVoiceSessionConfig = {
  maxInputAudioChunks: number;
};

export type RealtimeVoiceTurnPhase =
  | "receiving-audio"
  | "final-transcript"
  | "assistant-response"
  | "interrupted";

type RealtimeVoiceStateBase = {
  config: RealtimeVoiceSessionConfig;
  timeline: readonly RealtimeVoiceSessionEvent[];
};

export type RealtimeVoiceSessionNotStartedState = RealtimeVoiceStateBase & {
  status: "not-started";
};

export type RealtimeVoiceSessionActiveState = RealtimeVoiceStateBase & {
  status: "active";
  sessionId: string;
  turnId: string;
  channelIdentity: RealtimeVoiceChannelIdentity;
  phase: RealtimeVoiceTurnPhase;
  inputAudioChunks: number;
};

export type RealtimeVoiceSessionCompletedState = RealtimeVoiceStateBase & {
  status: "completed";
  sessionId: string;
  turnId: string;
  channelIdentity: RealtimeVoiceChannelIdentity;
  reason: RealtimeVoiceCompletionEvent["reason"];
  inputAudioChunks: number;
};

export type RealtimeVoiceSessionErroredState = RealtimeVoiceStateBase & {
  status: "errored";
  sessionId: string;
  turnId: string;
  channelIdentity: RealtimeVoiceChannelIdentity;
  code: RealtimeVoiceTerminalErrorCode;
  message: string;
  inputAudioChunks: number;
};

export type RealtimeVoiceSessionState =
  | RealtimeVoiceSessionNotStartedState
  | RealtimeVoiceSessionActiveState
  | RealtimeVoiceSessionCompletedState
  | RealtimeVoiceSessionErroredState;

export class RealtimeVoiceSessionTransitionError extends Error {
  readonly stateStatus: RealtimeVoiceSessionState["status"];
  readonly eventType: RealtimeVoiceSessionEvent["type"];

  constructor(
    state: RealtimeVoiceSessionState,
    event: RealtimeVoiceSessionEvent,
    message: string,
  ) {
    super(message);
    this.name = "RealtimeVoiceSessionTransitionError";
    this.stateStatus = state.status;
    this.eventType = event.type;
  }
}

export const DEFAULT_REALTIME_VOICE_SESSION_CONFIG: RealtimeVoiceSessionConfig = {
  maxInputAudioChunks: 128,
};

export function createRealtimeVoiceSessionState(
  config: RealtimeVoiceSessionConfig = DEFAULT_REALTIME_VOICE_SESSION_CONFIG,
): RealtimeVoiceSessionNotStartedState {
  validateConfig(config);
  return {
    status: "not-started",
    config,
    timeline: [],
  };
}

export function applyRealtimeVoiceSessionEvent(
  state: RealtimeVoiceSessionState,
  event: RealtimeVoiceSessionEvent,
): RealtimeVoiceSessionState {
  validateEventShape(event);
  switch (state.status) {
    case "not-started":
      return applyToNotStartedState(state, event);
    case "active":
      return applyToActiveState(state, event);
    case "completed":
    case "errored":
      throw new RealtimeVoiceSessionTransitionError(
        state,
        event,
        `Realtime voice session "${state.sessionId}" is already terminal`,
      );
  }
}

export function createRealtimeVoiceProviderUnavailableEvent(
  state: RealtimeVoiceSessionActiveState,
  provider: "stt" | "tts",
  message: string,
): RealtimeVoiceTerminalErrorEvent {
  return createRealtimeVoiceTerminalErrorEvent(
    state,
    provider === "stt" ? "stt-unavailable" : "tts-unavailable",
    message,
  );
}

export function createRealtimeVoiceProviderFailedEvent(
  state: RealtimeVoiceSessionActiveState,
  provider: "stt" | "tts",
  message: string,
): RealtimeVoiceTerminalErrorEvent {
  return createRealtimeVoiceTerminalErrorEvent(
    state,
    provider === "stt" ? "stt-failed" : "tts-failed",
    message,
  );
}

export function createRealtimeVoiceTerminalErrorEvent(
  state: RealtimeVoiceSessionActiveState,
  code: RealtimeVoiceTerminalErrorCode,
  message: string,
): RealtimeVoiceTerminalErrorEvent {
  assertNonEmpty(message, "terminal error message");
  return {
    type: "realtime-voice.session-error",
    sessionId: state.sessionId,
    turnId: state.turnId,
    code,
    message,
  };
}

function applyToNotStartedState(
  state: RealtimeVoiceSessionNotStartedState,
  event: RealtimeVoiceSessionEvent,
): RealtimeVoiceSessionState {
  if (event.type !== "realtime-voice.session-started") {
    throw new RealtimeVoiceSessionTransitionError(
      state,
      event,
      `Realtime voice event "${event.type}" cannot occur before session start`,
    );
  }
  return {
    status: "active",
    config: state.config,
    timeline: appendEvent(state, event),
    sessionId: event.sessionId,
    turnId: event.turnId,
    channelIdentity: event.channelIdentity,
    phase: "receiving-audio",
    inputAudioChunks: 0,
  };
}

function applyToActiveState(
  state: RealtimeVoiceSessionActiveState,
  event: RealtimeVoiceSessionEvent,
): RealtimeVoiceSessionState {
  assertSameTurn(state, event);

  switch (event.type) {
    case "realtime-voice.session-started":
      throw new RealtimeVoiceSessionTransitionError(
        state,
        event,
        `Realtime voice session "${state.sessionId}" has already started`,
      );
    case "realtime-voice.input-audio-chunk":
      return applyInputAudioChunk(state, event);
    case "realtime-voice.partial-transcript":
      assertPhase(state, event, ["receiving-audio"]);
      return { ...state, timeline: appendEvent(state, event) };
    case "realtime-voice.final-transcript":
      assertPhase(state, event, ["receiving-audio"]);
      return {
        ...state,
        phase: "final-transcript",
        timeline: appendEvent(state, event),
      };
    case "realtime-voice.assistant-text":
      assertPhase(state, event, ["final-transcript"]);
      return {
        ...state,
        phase: "assistant-response",
        timeline: appendEvent(state, event),
      };
    case "realtime-voice.assistant-audio-chunk":
      assertPhase(state, event, ["assistant-response"]);
      return { ...state, timeline: appendEvent(state, event) };
    case "realtime-voice.turn-interrupted":
      assertPhase(state, event, ["receiving-audio", "final-transcript", "assistant-response"]);
      return {
        ...state,
        phase: "interrupted",
        timeline: appendEvent(state, event),
      };
    case "realtime-voice.session-completed":
      return {
        status: "completed",
        config: state.config,
        timeline: appendEvent(state, event),
        sessionId: state.sessionId,
        turnId: state.turnId,
        channelIdentity: state.channelIdentity,
        reason: event.reason,
        inputAudioChunks: state.inputAudioChunks,
      };
    case "realtime-voice.session-error":
      return {
        status: "errored",
        config: state.config,
        timeline: appendEvent(state, event),
        sessionId: state.sessionId,
        turnId: state.turnId,
        channelIdentity: state.channelIdentity,
        code: event.code,
        message: event.message,
        inputAudioChunks: state.inputAudioChunks,
      };
  }
}

function applyInputAudioChunk(
  state: RealtimeVoiceSessionActiveState,
  event: RealtimeVoiceInputAudioChunkEvent,
): RealtimeVoiceSessionState {
  assertPhase(state, event, ["receiving-audio"]);
  if (state.inputAudioChunks >= state.config.maxInputAudioChunks) {
    const errorEvent = createRealtimeVoiceTerminalErrorEvent(
      state,
      "chunk-budget-exceeded",
      `Realtime voice input exceeded ${state.config.maxInputAudioChunks} audio chunk(s)`,
    );
    return {
      status: "errored",
      config: state.config,
      timeline: appendEvent(state, errorEvent),
      sessionId: state.sessionId,
      turnId: state.turnId,
      channelIdentity: state.channelIdentity,
      code: errorEvent.code,
      message: errorEvent.message,
      inputAudioChunks: state.inputAudioChunks,
    };
  }
  return {
    ...state,
    timeline: appendEvent(state, event),
    inputAudioChunks: state.inputAudioChunks + 1,
  };
}

function appendEvent(
  state: RealtimeVoiceStateBase,
  event: RealtimeVoiceSessionEvent,
): readonly RealtimeVoiceSessionEvent[] {
  return [...state.timeline, event];
}

function assertSameTurn(
  state: RealtimeVoiceSessionActiveState,
  event: RealtimeVoiceSessionEvent,
): void {
  if (state.sessionId !== event.sessionId || state.turnId !== event.turnId) {
    throw new RealtimeVoiceSessionTransitionError(
      state,
      event,
      `Realtime voice event "${event.type}" belongs to a different session turn`,
    );
  }
}

function assertPhase(
  state: RealtimeVoiceSessionActiveState,
  event: RealtimeVoiceSessionEvent,
  allowed: readonly RealtimeVoiceTurnPhase[],
): void {
  if (!allowed.includes(state.phase)) {
    throw new RealtimeVoiceSessionTransitionError(
      state,
      event,
      `Realtime voice event "${event.type}" is not legal during "${state.phase}"`,
    );
  }
}

function validateConfig(config: RealtimeVoiceSessionConfig): void {
  if (!Number.isInteger(config.maxInputAudioChunks) || config.maxInputAudioChunks <= 0) {
    throw new Error("Realtime voice maxInputAudioChunks must be a positive integer");
  }
}

function validateEventShape(event: RealtimeVoiceSessionEvent): void {
  assertNonEmpty(event.sessionId, "sessionId");
  assertNonEmpty(event.turnId, "turnId");
  switch (event.type) {
    case "realtime-voice.session-started":
      assertNonEmpty(event.channelIdentity.channel, "channelIdentity.channel");
      assertNonEmpty(event.channelIdentity.channelUserId, "channelIdentity.channelUserId");
      break;
    case "realtime-voice.input-audio-chunk":
    case "realtime-voice.assistant-audio-chunk":
      assertAudioChunk(event.chunk);
      break;
    case "realtime-voice.partial-transcript":
    case "realtime-voice.final-transcript":
    case "realtime-voice.assistant-text":
      assertNonEmpty(event.text, "text");
      break;
    case "realtime-voice.session-error":
      assertNonEmpty(event.message, "terminal error message");
      break;
    case "realtime-voice.turn-interrupted":
    case "realtime-voice.session-completed":
      break;
  }
}

function assertAudioChunk(chunk: RealtimeVoiceAudioChunk): void {
  assertNonEmpty(chunk.chunkId, "chunkId");
  assertNonEmpty(chunk.mimeType, "mimeType");
  if (chunk.audio.byteLength === 0) {
    throw new Error("Realtime voice audio chunk is empty");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`Realtime voice ${label} is empty`);
  }
}

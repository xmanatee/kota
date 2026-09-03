import type { DaemonHttp } from './daemon/http';
import * as push from './daemon/push';
import * as sessions from './daemon/sessions';
import * as ui from './daemon/ui';
import type {
  UiAction,
  UiActionExecutionResult,
  UiDaemonRouteDocument,
  UiJsonValue,
  UiSurfaceBundle,
} from './daemon/ui';
import * as voice from './daemon/voice';
import type {
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from './daemon/voice';

export class DaemonClient {
  private readonly http: DaemonHttp;

  constructor(baseUrl: string, token: string) {
    this.http = { baseUrl, token };
  }

  getUiSurfaces(scopeId?: string): Promise<UiSurfaceBundle> {
    return ui.getUiSurfaces(this.http, scopeId);
  }

  executeUiAction(
    action: UiAction,
    parameters?: UiJsonValue,
    confirmed = false,
  ): Promise<UiActionExecutionResult> {
    return ui.executeUiAction(this.http, action, parameters, confirmed);
  }

  getUiDaemonRoute(path: string): Promise<UiDaemonRouteDocument> {
    return ui.getUiDaemonRoute(this.http, path);
  }

  registerPushToken(deviceId: string, token: string): Promise<{ ok: boolean }> {
    return push.registerPushToken(this.http, deviceId, token);
  }

  deleteSession(id: string): Promise<void> {
    return sessions.deleteSession(this.http, id);
  }

  voiceTranscribe(input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResult> {
    return voice.voiceTranscribe(this.http, input);
  }

  voiceSynthesize(input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResult> {
    return voice.voiceSynthesize(this.http, input);
  }

  chatUrl(sessionId: string): string {
    return sessions.chatUrl(this.http, sessionId);
  }

  sseUrl(since?: string): string {
    return sessions.sseUrl(this.http, since);
  }

  get authHeader(): string {
    return `Bearer ${this.http.token}`;
  }
}

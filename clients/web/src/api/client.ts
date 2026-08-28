import {
  type ClientIdentity,
  parseClientIdentity,
} from "../../../conformance/daemon-contract.generated";
import { chatApi } from "./client-chat";
import { apiDecoded } from "./client-runtime";
import { uiApi } from "./client-ui";
import { voiceApi } from "./client-voice";

export const api = {
  getIdentity: (): Promise<ClientIdentity> =>
    apiDecoded("/identity", parseClientIdentity),
  ...chatApi,
  ...voiceApi,
  ...uiApi,
};

export { apiFetch, getAuthToken } from "./client-runtime";
export type {
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from "./client-voice";

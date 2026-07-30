import {
  parseScopePolicyRouteResponse,
  parseScopeRegistryProjection,
} from "../../../conformance/decoders";
import type {
  CapabilityReadinessResponse,
  ClientIdentity,
  HealthStatus,
  ScopePolicyRouteResponse,
  ScopeRegistryProjection,
} from "./types";
import { knowledgeApi } from "./client-knowledge";
import { operatorApi } from "./client-operator";
import { apiDecoded, apiJson } from "./client-runtime";
import { voiceApi } from "./client-voice";
import { workflowApi } from "./client-workflows";

export const api = {
  getHealth: () => apiJson<HealthStatus>("/api/health"),
  getCapabilities: () => apiJson<CapabilityReadinessResponse>("/capabilities"),
  getIdentity: () => apiJson<ClientIdentity>("/identity"),
  getScopes: () => apiDecoded<ScopeRegistryProjection>(
    "/scopes",
    parseScopeRegistryProjection,
  ),
  getScopePolicy: (scopeId: string) => apiDecoded<ScopePolicyRouteResponse>(
    `/scopes/${encodeURIComponent(scopeId)}/policy`,
    parseScopePolicyRouteResponse,
  ),
  ...workflowApi,
  ...operatorApi,
  ...knowledgeApi,
  ...voiceApi,
};

export { apiFetch, getAuthToken } from "./client-runtime";
export type { VoiceSynthesizeResult, VoiceTranscribeResult } from "./client-voice";

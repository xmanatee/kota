import { isAbsolute } from "node:path";
import type { AgentEffort } from "#core/agent-harness/index.js";
import { requireAgyModelEvaluationIsolation } from "./agy-model-evaluation-isolation.js";
import type { AgyModelEvaluationOptions } from "./agy-model-evaluation-types.js";
import type {
  EvalRunIsolationBackend,
  EvalRunOptions,
} from "./client.js";
import {
  type EvalJsonObject,
  type EvalJsonValue,
  isEvalJsonObject,
} from "./eval-route-http.js";
import {
  type ContainerNetworkPolicyRequest,
  type ProviderEgressProvider,
  validateProviderEgressProxyUrl,
} from "./provider-egress.js";

const NUMERIC_OPTION_KEYS = [
  "repeatCount",
  "cpuAllocationCores",
  "cpuKillThresholdCores",
  "memoryAllocationMB",
  "memoryKillThresholdMB",
] as const;

export function validateEvalRunRequest(raw: EvalJsonValue): EvalRunOptions {
  if (!isEvalJsonObject(raw)) {
    throw new Error("Body must be a JSON object.");
  }
  const request = raw;
  const options: EvalRunOptions = {};
  if (request.fixtureIds !== undefined) {
    const fixtureIds = request.fixtureIds;
    if (
      !Array.isArray(fixtureIds) ||
      !fixtureIds.every((id): id is string => typeof id === "string")
    ) {
      throw new Error("fixtureIds must be an array of strings.");
    }
    options.fixtureIds = fixtureIds;
  }
  for (const key of NUMERIC_OPTION_KEYS) {
    const value = request[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${String(key)} must be a positive number.`);
    }
    options[key] = value;
  }
  if (request.hostClass !== undefined) {
    if (
      typeof request.hostClass !== "string" ||
      request.hostClass.length === 0
    ) {
      throw new Error("hostClass must be a non-empty string.");
    }
    options.hostClass = request.hostClass;
  }
  if (request.keepWorkingDirs !== undefined) {
    if (typeof request.keepWorkingDirs !== "boolean") {
      throw new Error("keepWorkingDirs must be a boolean.");
    }
    options.keepWorkingDirs = request.keepWorkingDirs;
  }
  if (request.isolationBackend !== undefined) {
    const backend = request.isolationBackend;
    if (!isEvalJsonObject(backend)) {
      throw new Error("isolationBackend must be an object.");
    }
    options.isolationBackend = validateIsolationBackend(backend);
  }
  return options;
}

export function validateAgyModelEvaluationRequest(
  raw: EvalJsonValue,
): AgyModelEvaluationOptions {
  if (!isEvalJsonObject(raw)) {
    throw new Error("Body must be a JSON object.");
  }
  const candidates = raw.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    !candidates.every(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
  ) {
    throw new Error("candidates must be a non-empty array of model strings.");
  }
  if (raw.effort !== undefined && typeof raw.effort !== "string") {
    throw new Error("effort must be a string.");
  }
  const options = validateEvalRunRequest(raw);
  if (options.fixtureIds !== undefined) {
    throw new Error("AGY model evaluation selects its canonical scenario suite.");
  }
  const isolationBackend = requireAgyModelEvaluationIsolation(
    options.isolationBackend,
  );
  return {
    ...options,
    candidates,
    isolationBackend,
    ...(raw.effort !== undefined && {
      effort: raw.effort as AgentEffort,
    }),
  };
}

function validateIsolationBackend(
  request: EvalJsonObject,
): EvalRunIsolationBackend {
  if (request.kind === "host-subprocess") {
    return { kind: "host-subprocess" };
  }
  if (request.kind !== "container") {
    throw new Error(
      'isolationBackend.kind must be "host-subprocess" or "container".',
    );
  }
  if (typeof request.executable !== "string" || request.executable.length === 0) {
    throw new Error("isolationBackend.executable must be a non-empty string.");
  }
  if (typeof request.image !== "string" || request.image.length === 0) {
    throw new Error("isolationBackend.image must be a non-empty string.");
  }
  if (
    typeof request.kotaBinaryPath !== "string" ||
    request.kotaBinaryPath.length === 0
  ) {
    throw new Error(
      "isolationBackend.kotaBinaryPath must be a non-empty string.",
    );
  }
  if (!isAbsolute(request.kotaBinaryPath)) {
    throw new Error(
      "isolationBackend.kotaBinaryPath must be an absolute container path.",
    );
  }
  return {
    kind: "container",
    executable: request.executable,
    image: request.image,
    kotaBinaryPath: request.kotaBinaryPath,
    networkPolicy: validateNetworkPolicy(request.networkPolicy),
  };
}

function validateProvider(raw: string): ProviderEgressProvider {
  if (
    raw === "anthropic" ||
    raw === "openai" ||
    raw === "openrouter" ||
    raw === "google"
  ) {
    return raw;
  }
  throw new Error(
    "isolationBackend.networkPolicy.provider must be anthropic, openai, openrouter, or google.",
  );
}

function validateNetworkPolicy(
  raw: EvalJsonValue | undefined,
): ContainerNetworkPolicyRequest {
  if (raw === undefined) return { kind: "offline" };
  if (!isEvalJsonObject(raw)) {
    throw new Error("isolationBackend.networkPolicy must be an object.");
  }
  const request = raw;
  if (request.kind === "offline") return { kind: "offline" };
  if (request.kind !== "provider-egress") {
    throw new Error(
      'isolationBackend.networkPolicy.kind must be "offline" or "provider-egress".',
    );
  }
  if (typeof request.provider !== "string" || request.provider.length === 0) {
    throw new Error(
      "isolationBackend.networkPolicy.provider must be a non-empty string.",
    );
  }
  if (
    !isEvalJsonObject(request.enforcement)
  ) {
    throw new Error("isolationBackend.networkPolicy.enforcement must be an object.");
  }
  if (request.enforcement.kind !== "docker-internal-proxy") {
    throw new Error(
      'isolationBackend.networkPolicy.enforcement.kind must be "docker-internal-proxy".',
    );
  }
  const { networkName, proxyUrl } = request.enforcement;
  if (typeof networkName !== "string" || networkName.length === 0) {
    throw new Error(
      "isolationBackend.networkPolicy.enforcement.networkName must be a non-empty string.",
    );
  }
  if (typeof proxyUrl !== "string" || proxyUrl.length === 0) {
    throw new Error(
      "isolationBackend.networkPolicy.enforcement.proxyUrl must be a non-empty string.",
    );
  }
  validateProviderEgressProxyUrl(proxyUrl);
  return {
    kind: "provider-egress",
    provider: validateProvider(request.provider),
    enforcement: { kind: "docker-internal-proxy", networkName, proxyUrl },
  };
}

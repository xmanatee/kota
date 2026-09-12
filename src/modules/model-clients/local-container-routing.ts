/** Fixed local-runtime targets reached only through the eval owner's internal
 * provider proxy. This is endpoint selection, not proof of network isolation. */
export const LOCAL_CONTAINER_ENDPOINTS = {
  ollama: { protocol: "http", host: "host.docker.internal", port: 11434 },
  lmstudio: { protocol: "http", host: "host.docker.internal", port: 1234 },
} as const;

export function localContainerBaseUrl(provider: string): string | undefined {
  if (provider !== "ollama" && provider !== "lmstudio") return undefined;
  const endpoint = LOCAL_CONTAINER_ENDPOINTS[provider];
  return `${endpoint.protocol}://${endpoint.host}:${endpoint.port}/v1`;
}

export function containedLocalProviderBaseUrl(
  provider: string,
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE !== "1") return explicit;
  const url = localContainerBaseUrl(provider);
  if (url === undefined) return explicit;
  if (env.KOTA_EVAL_PROVIDER_EGRESS_PROVIDER !== provider ||
    env.KOTA_EVAL_LOCAL_MODEL_BASE_URL !== url) {
    throw new Error("Contained local model route requires its matching provider endpoint and egress policy.");
  }
  if (explicit !== undefined && explicit.replace(/\/+$/, "") !== url) {
    throw new Error("Configured model endpoint conflicts with the contained local provider route.");
  }
  return url;
}

/** Provider inference and login renewal share this allowlist in native and
 * contained launches. Task-tool networking remains governed separately. */
export const CODEX_PROVIDER_EGRESS_ENDPOINTS = [
  { id: "openai-api", protocol: "https", host: "api.openai.com", port: 443 },
  { id: "openai-auth", protocol: "https", host: "auth.openai.com", port: 443 },
  { id: "openai-chatgpt", protocol: "https", host: "chatgpt.com", port: 443 },
] as const;

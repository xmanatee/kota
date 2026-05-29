import { afterEach, describe, expect, it } from "vitest";
import { buildExecutionEnv } from "./execution-env.js";

const SAVED_ENV: Record<string, string | undefined> = {};
const TOUCHED_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "OPENAI_API_KEY",
  "KOTA_EVAL_PROVIDER_EGRESS_ACTIVE",
  "KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS",
  "KOTA_EVAL_PROVIDER_EGRESS_PROXY_URL",
  "KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS",
  "KOTA_EVAL_PROVIDER_EGRESS_PROVIDER",
  "KOTA_EVAL_PROVIDER_EGRESS_SCOPE",
  "KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY",
  "KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS",
] as const;

for (const key of TOUCHED_KEYS) {
  SAVED_ENV[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of TOUCHED_KEYS) {
    const saved = SAVED_ENV[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

function clearTouchedEnv(): void {
  for (const key of TOUCHED_KEYS) {
    delete process.env[key];
  }
}

describe("buildExecutionEnv", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("strips eval-harness provider-egress proxy and auth env from task subprocesses", () => {
    clearTouchedEnv();
    process.env.HTTP_PROXY = "http://provider-proxy:8080";
    process.env.HTTPS_PROXY = "http://provider-proxy:8080";
    process.env.ALL_PROXY = "http://provider-proxy:8080";
    process.env.http_proxy = "http://provider-proxy:8080";
    process.env.https_proxy = "http://provider-proxy:8080";
    process.env.all_proxy = "http://provider-proxy:8080";
    process.env.OPENAI_API_KEY = "sk-provider-egress-test";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE = "1";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS = "OPENAI_API_KEY";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_PROXY_URL =
      "http://provider-proxy:8080";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS =
      "https://api.openai.com:443";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_PROVIDER = "openai";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_SCOPE =
      "whole-container-provider-proxy";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY =
      "kota-tool-provider-env-filter";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS = "openai-tools";

    const env = buildExecutionEnv({
      sessionId: "session-1",
      toolUseId: "tool-1",
    });

    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.http_proxy).toBeUndefined();
    expect(env.https_proxy).toBeUndefined();
    expect(env.all_proxy).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_PROXY_URL).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_PROVIDER).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_SCOPE).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY).toBeUndefined();
    expect(env.KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS).toBeUndefined();
    expect(env.KOTA_SESSION_ID).toBe("session-1");
    expect(env.KOTA_TOOL_USE_ID).toBe("tool-1");
  });

  it("keeps ordinary operator proxy env when provider-egress mode is not active", () => {
    clearTouchedEnv();
    process.env.HTTPS_PROXY = "http://operator-proxy:8080";

    const env = buildExecutionEnv();

    expect(env.HTTPS_PROXY).toBe("http://operator-proxy:8080");
  });

  it("fails loudly when provider-egress auth env metadata is malformed", () => {
    clearTouchedEnv();
    process.env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE = "1";
    process.env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS = "OPENAI-API-KEY";

    expect(() => buildExecutionEnv()).toThrow(
      /KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS contains invalid env key/,
    );
  });
});

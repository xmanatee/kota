import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
import { withNativeCliSandbox } from "#core/agent-harness/native-cli-sandbox.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { enforcedProviderEgressNetworkPolicy, providerEgressTaskSubprocessBoundary } from "#modules/eval-harness/provider-egress.js";
import { containerExecutionEnv } from "#modules/eval-harness/subprocess-executor-env.js";

// The native subprocess launcher is the controlled external port. Reject there
// instead of emulating sandbox, process, credential, or transport behavior.
vi.mock("#core/agent-harness/native-cli-sandbox.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("#core/agent-harness/native-cli-sandbox.js")>(),
  withNativeCliSandbox: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Detects loss of the eval container's inherited upstream proxy in the Codex
// adapter even when ordinary workflow per-run env does not carry proxy metadata.
it("preserves contained provider routing through the Codex adapter's native launch", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-codex-contained-egress-"));
  roots.push(root);
  const proxyUrl = "http://provider-proxy:8080";
  const policy = enforcedProviderEgressNetworkPolicy({
    kind: "provider-egress", provider: "openai",
    enforcement: { kind: "docker-internal-proxy", networkName: "eval-egress", proxyUrl },
  }, providerEgressTaskSubprocessBoundary({ agentHarness: "codex", toolControl: "native" }));
  const env = containerExecutionEnv({ kotaBinaryPath: "/opt/kota/bin/kota.mjs" }, {
    workflowName: "noop", workingDir: root, budgetMs: 5000,
  }, "/opt/kota/dist", policy);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("CODEX_HOME", "/run/codex-login");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-unrelated-api-key");
  vi.stubEnv("UNRELATED_SECRET", "synthetic-secret");
  const stop = new Error("controlled native launch boundary");
  vi.mocked(withNativeCliSandbox).mockRejectedValue(stop);
  await expect(codexAgentHarness.run({
    prompt: "probe", cwd: root, model: "gpt-5.5", effort: "low",
    env: { KOTA_TEST_WORKFLOW_VALUE: "retained" },
  })).rejects.toThrow(stop);
  expect(withNativeCliSandbox).toHaveBeenCalledOnce();
  const launch = vi.mocked(withNativeCliSandbox).mock.calls[0]![2];
  expect(launch.env[NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]).toBe(proxyUrl);
  expect(launch.env.CODEX_HOME).toBe("/run/codex-login");
  expect(launch.env.KOTA_TEST_WORKFLOW_VALUE).toBe("retained");
  expect(launch.env.OPENAI_API_KEY).toBeUndefined();
  expect(launch.env.UNRELATED_SECRET).toBeUndefined();
  expect(launch.env.HTTP_PROXY).toBeUndefined();
  expect(launch.env.HTTPS_PROXY).toBeUndefined();
  expect(launch.allowedEgressHosts).toContain("auth.openai.com");
});

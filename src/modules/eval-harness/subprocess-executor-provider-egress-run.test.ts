import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
import {
  PROVIDER_EGRESS_NETWORK_LABELS,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
} from "./provider-egress.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeContainerBackend,
  writeFakeKotaScript,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor provider-egress container execution", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    delete process.env.KOTA_FAKE_CONTAINER_LOG;
    delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE;
    delete process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH;
    delete process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS;
    cleanupSubprocessTestDirs(dirs);
  });

  it("runs provider-egress containers as non-gating with provider proxy and auth env", async () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    const fakeKota = join(dirs.binariesDir, "kota-provider-egress.mjs");
    const containerKotaBinaryPath = "/opt/kota/bin/kota.mjs";
    const fakeContainerLog = join(dirs.workingDir, "container-provider-log.jsonl");
    const endpoints = providerEgressEndpointsFor("openai");
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    writeFakeContainerBackend(fakeContainer);
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'provider-env.json'), JSON.stringify({",
        "  httpProxy: process.env.HTTP_PROXY,",
        "  httpsProxy: process.env.HTTPS_PROXY,",
        `  nativeCliUpstreamProxy: process.env.${NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV},`,
        "  nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY,",
        "  apiKey: process.env.OPENAI_API_KEY,",
        "  authEnvKeys: process.env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS,",
        "  provider: process.env.KOTA_EVAL_PROVIDER_EGRESS_PROVIDER,",
        "  endpoints: process.env.KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS,",
        "  taskBoundary: process.env.KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY,",
        "  agentHarness: process.env.KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-provider-egress');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-provider-egress', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );
    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH = containerKotaBinaryPath;
    process.env.KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE = fakeKota;
    process.env.KOTA_FAKE_CONTAINER_LOG = fakeContainerLog;
    process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS = JSON.stringify({
      [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
      [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "openai",
      [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]:
        providerEgressEndpointLabelValue(endpoints),
    });
    process.env.OPENAI_API_KEY = "sk-parent-provider-egress-test";
    try {
      const executor = createSubprocessExecutor({
        kotaBinaryPath: fakeKota,
        extraEnv: { OPENAI_API_KEY: "sk-provider-egress-test" },
        providerEgressTaskBoundary: {
          agentHarness: "openai-tools",
          toolControl: "kota",
        },
        isolationBackend: providerEgressBackend(
          fakeContainer,
          containerKotaBinaryPath,
        ),
      });
      const preflight = executor.preflight(containerProfile());
      expect(preflight.status).toBe("non-gating");
      expect(preflight.gateEligible).toBe(false);

      const outcome = await executor.execute({
        workflowName: "noop",
        workingDir: dirs.workingDir,
        budgetMs: 5_000,
        executionProfile: preflight,
      });

      expect(outcome.kind).toBe("completed");
      const envCapture = JSON.parse(
        readFileSync(join(dirs.workingDir, "provider-env.json"), "utf8"),
      ) as Record<string, string>;
      const endpointLabel = providerEgressEndpointLabelValue(endpoints);
      expect(envCapture.httpProxy).toBe("http://provider-proxy:8080");
      expect(envCapture.httpsProxy).toBe("http://provider-proxy:8080");
      expect(envCapture.nativeCliUpstreamProxy).toBe(
        "http://provider-proxy:8080",
      );
      expect(envCapture.nodeUseEnvProxy).toBe("1");
      expect(envCapture.apiKey).toBe("sk-provider-egress-test");
      expect(envCapture.authEnvKeys).toBe("OPENAI_API_KEY");
      expect(envCapture.provider).toBe("openai");
      expect(envCapture.endpoints).toBe(endpointLabel);
      expect(envCapture.taskBoundary).toBe("kota-tool-provider-env-filter");
      expect(envCapture.agentHarness).toBe("openai-tools");

      const log = JSON.parse(
        readFileSync(fakeContainerLog, "utf8").trim().split("\n")[0]!,
      ) as {
        args: string[];
        env: Record<string, string>;
        envFiles: string[];
        envFileModes: string[];
        inheritedOpenAiApiKey?: string;
      };
      const networkIndex = log.args.indexOf("--network");
      expect(log.args[networkIndex + 1]).toBe("kota-provider-egress");
      const argvText = log.args.join("\0");
      expect(argvText).not.toContain("sk-provider-egress-test");
      expect(argvText).not.toContain("OPENAI_API_KEY=sk-provider-egress-test");
      expect(log.args).toContain("--env-file");
      expect(log.args).not.toContain("--env");
      expect(log.envFiles).toHaveLength(1);
      expect(log.envFileModes).toEqual(["600"]);
      expect(existsSync(log.envFiles[0]!)).toBe(false);
      expect(log.inheritedOpenAiApiKey).toBeUndefined();
      expect(log.env.HTTPS_PROXY).toBe("http://provider-proxy:8080");
      expect(log.env[NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]).toBe(
        "http://provider-proxy:8080",
      );
      expect(log.env.NODE_USE_ENV_PROXY).toBe("1");
      expect(log.env.OPENAI_API_KEY).toBe("sk-provider-egress-test");
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE).toBe("1");
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS).toBe(
        "OPENAI_API_KEY",
      );
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS).toBe(endpointLabel);
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_SCOPE).toBe(
        "whole-container-provider-proxy",
      );
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY).toBe(
        "kota-tool-provider-env-filter",
      );
      expect(log.env.KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS).toBe(
        "openai-tools",
      );
    } finally {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      }
    }
  });
});

function containerProfile() {
  return {
    hostClass: "container-test",
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 1024,
    memoryKillThresholdMB: 2048,
  };
}

function providerEgressBackend(executable: string, kotaBinaryPath: string) {
  return {
    kind: "container" as const,
    executable,
    image: "kota-eval:latest",
    kotaBinaryPath,
    networkPolicy: {
      kind: "provider-egress" as const,
      provider: "openai" as const,
      enforcement: {
        kind: "docker-internal-proxy" as const,
        networkName: "kota-provider-egress",
        proxyUrl: "http://provider-proxy:8080",
      },
    },
  };
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateIsolationBackend } from "./eval-request-validation.js";
import { PROVIDER_EGRESS_NETWORK_LABELS, providerEgressEndpointLabelValue, providerEgressEndpointsFor } from "./provider-egress.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import { cleanupSubprocessTestDirs, createSubprocessTestDirs, type SubprocessTestDirs, writeFakeContainerBackend, writeFakeKotaScript } from "./subprocess-executor-test-helpers.js";

const dirs: SubprocessTestDirs[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const entry of dirs.splice(0)) cleanupSubprocessTestDirs(entry); });
const profile = { hostClass: "contained-route-test", cpuAllocationCores: 1, cpuKillThresholdCores: 1, memoryAllocationMB: 512, memoryKillThresholdMB: 512 };

describe("contained route launch propagation", () => {
  it("rejects unavailable adapter login before a container launch", async () => {
    const entry = createSubprocessTestDirs(); dirs.push(entry);
    const docker = join(entry.binariesDir, "docker.mjs");
    const log = join(entry.binariesDir, "launch.jsonl");
    writeFakeContainerBackend(docker);
    vi.stubEnv("KOTA_FAKE_CONTAINER_LOG", log);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: "unused",
      isolationBackend: { kind: "container", executable: docker, image: "ready", kotaBinaryPath: "/opt/kota/bin/kota.mjs" },
      containerAuth: { sourceFile: join(entry.binariesDir, "absent-login"), containerDirectory: "/run/test-login", fileName: "auth.json", locatorEnvKey: "CODEX_HOME" },
    });
    const preflight = executor.preflight(profile);
    expect(preflight).toMatchObject({ status: "non-gating", verification: "unverified", gateEligible: false });
    expect(preflight.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining("login is unavailable or unreadable") }));
    const result = await executor.execute({ workflowName: "noop", workingDir: entry.workingDir, budgetMs: 5000, executionProfile: preflight });
    expect(result.kind).toBe("error");
    expect(existsSync(log)).toBe(false);
  });

  it.each(["openai", "ollama", "lmstudio"] as const)("carries %s routing through the shared container launcher and preserves non-gating status", async (provider) => {
    const entry = createSubprocessTestDirs(); dirs.push(entry);
    const docker = join(entry.binariesDir, "docker.mjs");
    const binary = join(entry.binariesDir, "kota.mjs");
    const log = join(entry.binariesDir, "launch.jsonl");
    const sourceFile = join(entry.binariesDir, "login.json");
    writeFileSync(sourceFile, "synthetic-login");
    writeFakeContainerBackend(docker);
    writeFakeKotaScript(binary, "process.exit(1);");
    vi.stubEnv("KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH", "/opt/kota/bin/kota.mjs");
    vi.stubEnv("KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE", binary);
    vi.stubEnv("KOTA_FAKE_CONTAINER_LOG", log);
    vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({
      [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
      [PROVIDER_EGRESS_NETWORK_LABELS.provider]: provider,
      [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]: providerEgressEndpointLabelValue(providerEgressEndpointsFor(provider)),
    }));
    const native = provider === "openai";
    const executor = createSubprocessExecutor({
      kotaBinaryPath: binary,
      isolationBackend: validateIsolationBackend({
        kind: "container", executable: docker, image: "test:image", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: { kind: "provider-egress", provider, enforcement: { kind: "docker-internal-proxy", networkName: "test-net", proxyUrl: "http://test-proxy:8080" } },
      }),
      providerEgressTaskBoundary: { agentHarness: native ? "codex" : "openai-tools", toolControl: native ? "native" : "kota" },
      ...(native ? { containerAuth: { sourceFile, containerDirectory: "/run/test-login", fileName: "auth.json", locatorEnvKey: "CODEX_HOME" } } : {}),
    });
    if (native) {
      // A deployed proxy policy without login renewal must reject the route
      // before it can consume a credential or attempt inference.
      const completeLabels = process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS!;
      vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({
        [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
        [PROVIDER_EGRESS_NETWORK_LABELS.provider]: provider,
        [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]: "https://api.openai.com:443,https://chatgpt.com:443",
      }));
      const incomplete = executor.preflight(profile);
      expect(incomplete).toMatchObject({ verification: "unverified", gateEligible: false, networkPolicy: { enforcementMode: "unavailable" } });
      const rejected = await executor.execute({ workflowName: "noop", workingDir: entry.workingDir, budgetMs: 5000, executionProfile: incomplete });
      expect(rejected.kind).toBe("error");
      expect(existsSync(log)).toBe(false);
      vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", completeLabels);
    }
    const preflight = executor.preflight(profile);
    expect(preflight).toMatchObject({ status: "non-gating", gateEligible: false, networkPolicy: { provider, enforcementMode: "docker-internal-proxy" } });
    const result = await executor.execute({ workflowName: "noop", workingDir: entry.workingDir, budgetMs: 5000, executionProfile: preflight });
    expect(result.kind).toBe("error");
    const launch = JSON.parse(readFileSync(log, "utf8").trim());
    expect(launch.env.KOTA_EVAL_PROVIDER_EGRESS_PROVIDER).toBe(provider);
    expect(launch.env.HTTP_PROXY).toBe("http://test-proxy:8080");
    if (native) {
      expect(preflight.networkPolicy).toMatchObject({ allowedProviderEndpoints: expect.arrayContaining([
        { id: "openai-auth", protocol: "https", host: "auth.openai.com", port: 443 },
      ]) });
      expect(launch.env.KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS.split(",")).toContain("https://auth.openai.com:443");
      expect(launch.env.CODEX_HOME).toBe("/run/test-login");
      const mount: string = launch.args.find((arg: string) => arg.includes("target=/run/test-login"));
      expect(mount).toContain(",readonly");
      const snapshot = mount.split("source=")[1]!.split(",target=")[0]!;
      expect(existsSync(snapshot)).toBe(false);
      expect(readFileSync(sourceFile, "utf8")).toBe("synthetic-login");
      expect(readFileSync(log, "utf8")).not.toContain("synthetic-login");
    } else {
      expect(launch.env.KOTA_EVAL_LOCAL_MODEL_BASE_URL).toBe(`http://host.docker.internal:${provider === "ollama" ? 11434 : 1234}/v1`);
      expect(launch.env.CODEX_HOME).toBeUndefined();
      expect(launch.env.KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS).toBe("");
    }
  });
});

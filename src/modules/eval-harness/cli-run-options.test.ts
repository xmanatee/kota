import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import { makeRunRecordingCtx } from "./cli-test-support.js";
import type { EvalRunOptions } from "./client.js";

describe("kota eval run CLI options", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("threads deliberate container selection into the eval run options", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--fixture",
        "builder-smoke",
        "--repeats",
        "1",
        "--host-class",
        "ci-container",
        "--cpu-allocation",
        "2",
        "--cpu-kill",
        "2",
        "--memory-allocation-mb",
        "1024",
        "--memory-kill-threshold-mb",
        "2048",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fixtureIds: ["builder-smoke"],
      repeatCount: 1,
      hostClass: "ci-container",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
      isolationBackend: {
        kind: "container",
        executable: "docker",
        image: "node:22-bookworm",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: { kind: "offline" },
      },
    });
  });

  it("threads provider-egress container policy into eval run options", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--repeats",
        "1",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
        "--container-network-policy",
        "provider-egress",
        "--provider-egress-network",
        "kota-provider-egress",
        "--provider-egress-proxy",
        "http://provider-proxy:8080",
        "--provider-egress-provider",
        "openai",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].isolationBackend).toEqual({
      kind: "container",
      executable: "docker",
      image: "node:22-bookworm",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      networkPolicy: {
        kind: "provider-egress",
        provider: "openai",
        enforcement: {
          kind: "docker-internal-proxy",
          networkName: "kota-provider-egress",
          proxyUrl: "http://provider-proxy:8080",
        },
      },
    });
  });

  it("accepts OpenRouter as a provider-egress catalog provider", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
        "--container-network-policy",
        "provider-egress",
        "--provider-egress-network",
        "kota-provider-egress",
        "--provider-egress-proxy",
        "http://provider-proxy:8080",
        "--provider-egress-provider",
        "openrouter",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].isolationBackend).toMatchObject({
      networkPolicy: {
        kind: "provider-egress",
        provider: "openrouter",
      },
    });
  });

  it("rejects container fields unless the operator selects container isolation", async () => {
    const calls: EvalRunOptions[] = [];
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await expect(
      cmd.parseAsync(
        [
          "run",
          "--container-executable",
          "docker",
          "--container-image",
          "node:22",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/require --isolation container/);
    expect(calls).toHaveLength(0);
  });

  it("rejects unsafe recording fixture ids before recorder extraction", async () => {
    const calls: EvalRunOptions[] = [];
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await expect(
      cmd.parseAsync(
        [
          "record-agent-step",
          "--run-id",
          "2026-04-24T00-00-00-000Z-builder-safe",
          "--step",
          "build",
          "--fixture",
          "../outside-fixture",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/--fixture must be a safe single path component/);
    expect(calls).toHaveLength(0);
  });
});

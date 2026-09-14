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

  // One case matrix owns the shared decoder's syntax/domain rejection. Other
  // command tests exercise option wiring without repeating this matrix.
  it.each([
    ["repeats", "1.5"], ["repeats", "3oops"], ["repeats", "1e3"],
    ["repeats", "0"], ["repeats", "-2"], ["repeats", "NaN"],
    ["repeats", "Infinity"], ["repeats", "9007199254740993"],
    ["repeats", ""], ["repeats", " 3"], ["repeats", "3\n"],
    ["repeats", "0x10"], ["repeats", "2.0"],
    ["cpu-allocation", "2oops"], ["cpu-allocation", "1e3"],
    ["cpu-allocation", "0"], ["cpu-allocation", "-0.5"],
    ["cpu-allocation", "NaN"], ["cpu-allocation", "Infinity"],
    ["cpu-allocation", "9".repeat(400)], ["cpu-allocation", ""],
    ["cpu-allocation", "0x10"], ["cpu-allocation", " 2.5"],
    ["cpu-allocation", "2.5\n"],
    ["cpu-kill", "2oops"], ["memory-allocation-mb", "1e3"],
    ["memory-kill-threshold-mb", "2.9"],
  ])("rejects --%s %j before dispatch", async (option, raw) => {
    const calls: EvalRunOptions[] = [];
    await expect(buildEvalCommand(makeRunRecordingCtx(calls)).parseAsync(
      ["run", `--${option}`, raw], { from: "user" },
    )).rejects.toThrow(`--${option} must be`);
    expect(calls).toEqual([]);
  });

  it("preserves the repeat default and absent resource fields", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await buildEvalCommand(makeRunRecordingCtx(calls)).parseAsync(["run"], { from: "user" });
    expect(calls).toEqual([{ repeatCount: 3 }]);
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
        "1.25",
        "--cpu-kill",
        "2.5",
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
      cpuAllocationCores: 1.25,
      cpuKillThresholdCores: 2.5,
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

  it.each(["openrouter", "ollama", "lmstudio"])("accepts %s as a provider-egress catalog provider", async (provider) => {
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
        provider,
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].isolationBackend).toMatchObject({
      networkPolicy: {
        kind: "provider-egress",
        provider,
      },
    });
  });

  it.each(["unsupported", "constructor"])("rejects unknown provider %s before dispatch", async (provider) => {
    const calls: EvalRunOptions[] = [];
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));
    await expect(cmd.parseAsync([
      "run", "--isolation", "container", "--container-executable", "docker",
      "--container-image", "node:22-bookworm", "--container-kota-binary-path", "/opt/kota/bin/kota.mjs",
      "--container-network-policy", "provider-egress", "--provider-egress-network", "kota-provider-egress",
      "--provider-egress-proxy", "http://provider-proxy:8080", "--provider-egress-provider", provider,
    ], { from: "user" })).rejects.toThrow(/--provider-egress-provider must be/);
    expect(calls).toHaveLength(0);
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


});

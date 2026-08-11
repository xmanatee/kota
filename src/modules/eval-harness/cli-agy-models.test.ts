import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgyModelEvaluationOptions } from "./agy-model-evaluation-types.js";
import { buildEvalCommand } from "./cli-command.js";
import { makeAgyRecordingCtx } from "./cli-test-support.js";

describe("kota eval agy-models CLI", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("forwards repeatable candidates and explicit maximum effort", async () => {
    const calls: AgyModelEvaluationOptions[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const command = buildEvalCommand(
      makeAgyRecordingCtx(calls, {
        ok: false,
        reason: "candidate_unavailable",
        message: "fixture response",
        artifactDir: "/tmp/agy-eval",
      }),
    );

    await command.parseAsync(
      [
        "agy-models",
        "--candidate",
        "gemini-3.6-flash",
        "--candidate",
        "gemini-3.5-pro",
        "--repeats",
        "2",
        "--effort",
        "max",
        "--host-class",
        "agy-benchmark-host",
        "--container-executable",
        "docker",
        "--container-image",
        "kota-eval:latest",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
        "--provider-egress-network",
        "kota-google-egress",
        "--provider-egress-proxy",
        "http://provider-proxy:8080",
        "--keep",
      ],
      { from: "user" },
    );

    expect(calls).toEqual([
      {
        candidates: ["gemini-3.6-flash", "gemini-3.5-pro"],
        repeatCount: 2,
        effort: "max",
        hostClass: "agy-benchmark-host",
        isolationBackend: {
          kind: "container",
          executable: "docker",
          image: "kota-eval:latest",
          kotaBinaryPath: "/opt/kota/bin/kota.mjs",
          networkPolicy: {
            kind: "provider-egress",
            provider: "google",
            enforcement: {
              kind: "docker-internal-proxy",
              networkName: "kota-google-egress",
              proxyUrl: "http://provider-proxy:8080",
            },
          },
        },
        keepWorkingDirs: true,
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a run before dispatch when isolated execution is not configured", async () => {
    const calls: AgyModelEvaluationOptions[] = [];
    const command = buildEvalCommand(
      makeAgyRecordingCtx(calls, {
        ok: false,
        reason: "isolation_configuration",
        message: "unused",
        artifactDir: null,
      }),
    );

    await expect(
      command.parseAsync(
        ["agy-models", "--candidate", "gemini-3.6-flash"],
        { from: "user" },
      ),
    ).rejects.toThrow(/requires --container-executable/);
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { makeRecordingTransport } from "./daemon-client-test-support.js";
import evalHarnessModule from "./index.js";

describe("eval-harness AGY daemon client", () => {
  it("contributes and routes the long-running model evaluation operation", async () => {
    const wireResult = {
      ok: false as const,
      reason: "candidate_unavailable" as const,
      message: "missing candidate",
      artifactDir: "/tmp/agy-eval",
    };
    const { transport, calls } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const options = {
      candidates: ["gemini-3.6-flash"],
      repeatCount: 2,
      effort: "max" as const,
      isolationBackend: {
        kind: "container" as const,
        executable: "docker",
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: {
          kind: "provider-egress" as const,
          provider: "google" as const,
          enforcement: {
            kind: "docker-internal-proxy" as const,
            networkName: "kota-google-egress",
            proxyUrl: "http://provider-proxy:8080",
          },
        },
      },
    };

    expect(typeof contributed.evalHarness!.runAgyModels).toBe("function");
    await expect(contributed.evalHarness!.runAgyModels(options)).resolves.toEqual(
      wireResult,
    );
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/eval/agy-models",
        body: options,
        init: { timeoutMs: 24 * 60 * 60 * 1000 },
        shape: "requestStrict",
      },
    ]);
  });
});

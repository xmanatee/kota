import { describe, expect, it } from "vitest";
import {
  type AgentHarnessRuntimeProbeDeps,
  probeNativeCliAuth,
  probeNativeCliRuntime,
  probeNodePackageRuntime,
} from "./readiness.js";

function fakeDeps(
  overrides: Partial<AgentHarnessRuntimeProbeDeps>,
): AgentHarnessRuntimeProbeDeps {
  return {
    resolveBinary: () => ({ status: "missing", detail: "not found" }),
    readCommandVersion: () => ({ status: "error", detail: "not run" }),
    readCommandOutput: () => ({ status: "error", detail: "not run" }),
    readPackageVersion: () => ({ status: "missing", detail: "not found" }),
    ...overrides,
  };
}

describe("agent harness readiness probes", () => {
  it("reports Codex CLI as missing when the codex binary is not on PATH", () => {
    const probe = probeNativeCliRuntime(
      {
        binaryName: "codex",
        versionArgs: ["--version"],
        required: true,
      },
      fakeDeps({
        resolveBinary: () => ({ status: "missing", detail: "codex not found" }),
      }),
    );

    expect(probe).toMatchObject({
      kind: "native-cli",
      status: "missing",
      required: true,
      binaryName: "codex",
      command: "codex --version",
    });
  });

  it("reports Codex CLI path and version when the version probe succeeds", () => {
    const probe = probeNativeCliRuntime(
      {
        binaryName: "codex",
        versionArgs: ["--version"],
        required: true,
      },
      fakeDeps({
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/codex",
        }),
        readCommandVersion: (command, args) => ({
          status: "ready",
          version: `${command} ${args.join(" ")} -> codex 0.130.0`,
        }),
      }),
    );

    expect(probe).toMatchObject({
      kind: "native-cli",
      status: "ready",
      executablePath: "/opt/bin/codex",
      version: "/opt/bin/codex --version -> codex 0.130.0",
    });
  });

  it("keeps a missing Gemini CLI informational when the SDK package is ready", () => {
    const deps = fakeDeps({
      resolveBinary: () => ({ status: "missing", detail: "gemini not found" }),
      readPackageVersion: () => ({ status: "ready", version: "1.51.0" }),
    });

    const sdk = probeNodePackageRuntime(
      { packageName: "@google/genai", required: true },
      deps,
    );
    const cli = probeNativeCliRuntime(
      {
        binaryName: "gemini",
        versionArgs: ["--version"],
        required: false,
        missingSummary:
          "gemini CLI not found on PATH; this is informational because KOTA's gemini harness is SDK-backed",
      },
      deps,
    );

    expect(sdk).toMatchObject({
      kind: "node-package",
      status: "ready",
      packageName: "@google/genai",
      version: "1.51.0",
    });
    expect(cli).toMatchObject({
      kind: "native-cli",
      status: "missing",
      required: false,
      binaryName: "gemini",
    });
  });

  it("reports Codex ChatGPT login ready from the local login-status command", () => {
    const probe = probeNativeCliAuth(
      {
        binaryName: "codex",
        statusArgs: ["login", "status"],
        required: true,
        readyPattern: /logged in using chatgpt/i,
        missingPattern: /not logged in|api key/i,
        readySummary: "Codex ChatGPT login active",
        missingSummary: "Codex ChatGPT login not active; run `codex login`",
      },
      fakeDeps({
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/codex",
        }),
        readCommandOutput: (command, args) => ({
          status: "ready",
          output: `${command} ${args.join(" ")} -> Logged in using ChatGPT`,
        }),
      }),
    );

    expect(probe).toMatchObject({
      kind: "harness-managed-login",
      status: "ready",
      required: true,
      command: "codex login status",
      summary: "Codex ChatGPT login active",
    });
  });

  it("reports Codex auth missing when login status is absent or API-key-only", () => {
    const probe = probeNativeCliAuth(
      {
        binaryName: "codex",
        statusArgs: ["login", "status"],
        required: true,
        readyPattern: /logged in using chatgpt/i,
        missingPattern: /not logged in|api key/i,
        readySummary: "Codex ChatGPT login active",
        missingSummary: "Codex ChatGPT login not active; run `codex login`",
      },
      fakeDeps({
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/codex",
        }),
        readCommandOutput: () => ({
          status: "ready",
          output: "Logged in using API key",
        }),
      }),
    );

    expect(probe).toMatchObject({
      kind: "harness-managed-login",
      status: "missing",
      required: true,
      summary: "Codex ChatGPT login not active; run `codex login`",
    });
  });
});

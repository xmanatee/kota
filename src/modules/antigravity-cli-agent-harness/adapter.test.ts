import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
  antigravityCliReadiness,
} from "./adapter.js";
import { antigravityCliAuthReadiness } from "./auth-readiness.js";

describe("antigravityCliAgentHarness readiness", () => {
  it("registers as the native Antigravity CLI readiness harness", () => {
    expect(antigravityCliAgentHarness.name).toBe(
      ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
    );
    expect(antigravityCliAgentHarness.name).toBe("antigravity-cli");
    expect(antigravityCliAgentHarness.supportsMultiTurn).toBe(true);
    expect(antigravityCliAgentHarness.askOwnerToolName).toBeNull();
    expect(antigravityCliAgentHarness.emitsAgentMessageStream).toBe(true);
    expect(antigravityCliAgentHarness.toolControl).toBe("native");
    expect(
      antigravityCliAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).toEqual(
      expect.arrayContaining([
        "allowedTools",
        "disallowedTools",
        "canUseTool",
        "askOwner",
        "mcpServers",
        "resumeSessionId",
      ]),
    );
    expect(
      antigravityCliAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).not.toContain("scopePolicy");
  });

  it("reports AGY runtime and headless model-access readiness", () => {
    const readiness = antigravityCliAgentHarness.readiness?.();

    expect(readiness).toMatchObject({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        command: "agy --version",
        binaryName: "agy",
        required: true,
      },
      localAuth: {
        kind: "harness-managed-login",
        command: "agy models",
        required: true,
      },
    });
  });

  it("accepts a successful AGY model catalog as authenticated readiness", () => {
    const readiness = antigravityCliAuthReadiness({
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/agy",
        }),
        readCommandVersion: () => ({ status: "error", detail: "not used" }),
        readCommandOutput: () => ({
          status: "ready",
          output: "gemini-3.7-flash-high\ngemini-3.1-pro-high",
        }),
        readPackageVersion: () => ({ status: "error", detail: "not used" }),
      });

    expect(readiness).toMatchObject({
      status: "ready",
      command: "agy models",
      summary: "Antigravity CLI login active and model catalog readable",
    });
    expect(readiness.detail).toContain("gemini-3.1-pro-high");
  });

  it("accepts AGY-managed unattended auth when the requested model is accessible", () => {
    const readiness = antigravityCliReadiness(
      {
        model: "gemini-3.7-flash",
        effort: "xhigh",
        unattended: true,
      },
      {
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/agy",
        }),
        readCommandVersion: () => ({ status: "ready", version: "1.1.12" }),
        readCommandOutput: () => ({
          status: "ready",
          output: "gemini-3.7-flash-high",
        }),
        readPackageVersion: () => ({ status: "error", detail: "not used" }),
      },
    );

    expect(readiness.localAuth).toMatchObject({
      status: "ready",
      required: true,
      summary: "Antigravity CLI login active and model catalog readable",
    });
    expect(readiness.modelEffort).toMatchObject({ status: "ready" });
  });
});

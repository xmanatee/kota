import { describe, expect, it } from "vitest";
import type { AgentHarnessRuntimeProbeDeps } from "#core/agent-harness/index.js";
import { antigravityCliReadiness } from "./adapter.js";

function readinessDeps(catalog: string): AgentHarnessRuntimeProbeDeps {
  return {
    resolveBinary: () => ({
      status: "ready",
      executablePath: "/opt/bin/agy",
    }),
    readCommandVersion: () => ({ status: "ready", version: "agy 2.0.0" }),
    readCommandOutput: () => ({ status: "ready", output: catalog }),
    readPackageVersion: () => ({ status: "error", detail: "not used" }),
  };
}

describe("Antigravity CLI model readiness", () => {
  it("marks the exact selected model and mapped effort as available", () => {
    const readiness = antigravityCliReadiness(
      { model: "gemini-readiness-candidate", effort: "max" },
      readinessDeps("gemini-readiness-candidate-high"),
    );

    expect(readiness.modelEffort).toMatchObject({
      status: "ready",
      model: "gemini-readiness-candidate",
      effort: "max",
      adapterModel: "gemini-readiness-candidate-high",
      command: "agy models",
    });
  });

  it("accepts an exact non-Gemini catalog model without inventing an effort suffix", () => {
    const readiness = antigravityCliReadiness(
      { model: "claude-opus-4-6-thinking", effort: "max" },
      readinessDeps(
        "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n" +
          "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
      ),
    );

    expect(readiness.modelEffort).toMatchObject({
      status: "ready",
      model: "claude-opus-4-6-thinking",
      effort: "max",
      adapterModel: "claude-opus-4-6-thinking",
    });
  });

  it("rejects an absent effort-qualified catalog entry", () => {
    const readiness = antigravityCliReadiness(
      { model: "gemini-readiness-candidate", effort: "xhigh" },
      readinessDeps("gemini-readiness-candidate-medium"),
    );

    expect(readiness.modelEffort).toMatchObject({
      status: "unavailable",
      adapterModel: "gemini-readiness-candidate-high",
      summary:
        "AGY model/effort gemini-readiness-candidate-high is unavailable",
    });
  });
});

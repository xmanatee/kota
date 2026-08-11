import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import { getPreset } from "#core/model/preset.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function registerUnattendedHarness(name: string, renewable: boolean): void {
  const harness: AgentHarness = {
    name,
    description: "builder preclaim test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    readiness: (request) => ({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "node-runtime",
        status: "ready",
        required: true,
        version: process.version,
        summary: "runtime ready",
      },
      localAuth: renewable || request?.unattended !== true
        ? {
            kind: "harness-managed-login",
            status: "ready",
            required: true,
            command: "fake auth status",
            detail: "renewal supported",
            summary: "login ready",
          }
        : {
            kind: "harness-managed-login",
            status: "unverifiable",
            required: true,
            command: "fake auth status",
            detail: "renewal not observable",
            summary: "unattended renewal cannot be verified",
          },
      optionalRuntimes: [],
      unsupportedOptions: [],
    }),
    run: async () => ({
      text: "unused",
      streamedText: "unused",
      turns: 0,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

describe("builder harness preflight", () => {
  it("records and rejects unverifiable unattended auth before claim", () => {
    const name = `preclaim-unverifiable-${Date.now()}`;
    registerUnattendedHarness(name, false);
    const root = mkdtempSync(join(tmpdir(), "kota-builder-preclaim-"));
    roots.push(root);
    const runDirPath = join(root, ".kota", "runs", "run-1");

    expect(() => runBuilderHarnessPreflight({
      agentRuntime: {
        preset: getPreset("codex"),
        harness: name,
        tiers: {
          fast: "fake-fast",
          balanced: "fake-balanced",
          capable: "fake-capable",
        },
        effort: "xhigh",
      },
      runDirPath,
    })).toThrow(/stopped before claiming work.*unattended renewal cannot be verified/);

    const artifactPath = join(
      runDirPath,
      "steps",
      "builder-preclaim.harness-capability.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      localReadiness: {
        localAuth: { status: "unverifiable", required: true },
      },
    });
  });

  it("accepts a harness that verifies unattended renewal", () => {
    const name = `preclaim-renewable-${Date.now()}`;
    registerUnattendedHarness(name, true);
    const root = mkdtempSync(join(tmpdir(), "kota-builder-preclaim-"));
    roots.push(root);

    expect(runBuilderHarnessPreflight({
      agentRuntime: {
        preset: getPreset("codex"),
        harness: name,
        tiers: {
          fast: "fake-fast",
          balanced: "fake-balanced",
          capable: "fake-capable",
        },
        effort: "xhigh",
      },
      runDirPath: join(root, ".kota", "runs", "run-1"),
    })).toMatchObject({
      harness: name,
      model: "fake-capable",
      ready: true,
    });
  });
});

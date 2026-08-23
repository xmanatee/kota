import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AvailableContainedWorkspaceSandbox } from "#core/agent-harness/task-probe-sandbox.js";
import type { ProductionReplacementArtifact } from "./production-replacement-evidence.js";
import {
  buildProductionReplacementTestEnvironment,
  buildProductionReplacementVitestLaunch,
  runProductionReplacementTests,
} from "./production-replacement-execution.js";
import { parseProductionReplacementDeclaration } from "./production-replacement-proof.js";
import {
  replacementArtifact,
  replacementDeclaration,
} from "./production-replacement-proof.test-helpers.js";

const sandboxMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("#core/agent-harness/task-probe-sandbox.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#core/agent-harness/task-probe-sandbox.js")
  >()),
  resolveContainedWorkspaceSandbox: sandboxMocks.resolve,
}));

describe("production replacement proof execution boundary", () => {
  it("launches Vitest only behind the resolved containment prefix", () => {
    const sandbox: AvailableContainedWorkspaceSandbox = {
      status: "available",
      kind: "linux-bubblewrap",
      processBoundary: "pid-namespace",
      command: "/usr/bin/prlimit",
      prefixArgs: ["--cpu=1800:1800", "--", "/usr/bin/bwrap", "--unshare-all", "--"],
      probeExecutable: "/opt/pnpm/bin/pnpm",
      evidence: "disposable overlay, offline namespaces, and hard limits",
    };

    expect(buildProductionReplacementVitestLaunch(
      sandbox,
      ["src/live.integration.test.ts"],
    )).toEqual({
      command: "/usr/bin/prlimit",
      args: [
        "--cpu=1800:1800",
        "--",
        "/usr/bin/bwrap",
        "--unshare-all",
        "--",
        "/opt/pnpm/bin/pnpm",
        "exec",
        "vitest",
        "run",
        "src/live.integration.test.ts",
        "--configLoader=runner",
        "--reporter=json",
      ],
    });
  });

  it("passes no daemon credential or inherited Node preload to proof code", () => {
    const env = buildProductionReplacementTestEnvironment(
      "/isolated/runtime-home",
      {
        PATH: "/usr/bin:/bin",
        HOME: "/operator/home",
        NODE_OPTIONS: "--require=/operator/credential-reader.js",
        KOTA_DAEMON_BEARER_TOKEN: "daemon-secret",
        OPENAI_API_KEY: "provider-secret",
      },
    );

    expect(env).toMatchObject({
      PATH: "/usr/bin:/bin",
      HOME: "/isolated/runtime-home",
      TMPDIR: "/isolated/runtime-home",
      NODE_OPTIONS: "--conditions=source",
      DEBUG: "vite:transform",
      NO_COLOR: "1",
    });
    expect(env).not.toHaveProperty("KOTA_DAEMON_BEARER_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("fails closed before loading a declared test when containment is unavailable", () => {
    sandboxMocks.resolve.mockReturnValueOnce({
      status: "unavailable",
      reason: "Bubblewrap and prlimit are unavailable",
    });
    const projectDir = mkdtempSync(join(tmpdir(), "kota-production-proof-sandbox-"));
    const parsed = parseProductionReplacementDeclaration(replacementDeclaration());
    if (parsed.kind !== "valid") throw new Error("fixture declaration is invalid");

    try {
      expect(runProductionReplacementTests({
        projectDir,
        declaration: parsed.declaration,
        artifact: replacementArtifact() as ProductionReplacementArtifact,
      })).toContain(
        "declared production tests were not executed because the required OS sandbox is unavailable",
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

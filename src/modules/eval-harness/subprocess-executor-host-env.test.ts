import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeKotaScript,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor host preflight and env filtering", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    cleanupSubprocessTestDirs(dirs);
  });

  it("marks host subprocess preflight as explicit non-gating evidence", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("host-subprocess");
    expect(preflight.gateEligible).toBe(false);
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("host-subprocess-unverified");
    expect(preflight.observedOrEnforcedProfile).toEqual(requestedProfile);
  });

  it("rejects requested resource profiles that do not match observed host facts", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
    });
    const observedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight({
      ...observedProfile,
      cpuKillThresholdCores: observedProfile.cpuKillThresholdCores + 1,
    });

    expect(preflight.status).toBe("rejected");
    if (preflight.status !== "rejected") throw new Error("unreachable");
    expect(preflight.rejectionReason).toBe("requested-observed-mismatch");
  });

  it("does not forward arbitrary parent env to host subprocess runs", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-host-env-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'host-env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  projectDir: process.env.KOTA_PROJECT_DIR,",
        "  distDir: process.env.KOTA_DIST_DIR,",
        "  cacheDir: process.env.XDG_CACHE_HOME,",
        "  storeDir: process.env.npm_config_store_dir,",
        "  path: process.env.PATH,",
        "  nodeOptions: process.env.NODE_OPTIONS,",
        "  preset: process.env.KOTA_PRESET,",
        "  activeAuth: process.env.ANTHROPIC_API_KEY,",
        "  unrelatedProviderAuth: process.env.OPENAI_API_KEY,",
        "  parentSecret: process.env.KOTA_PARENT_SECRET_LEAK_TEST,",
        "  callerSupplied: process.env.KOTA_CALLER_SUPPLIED_SECRET,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-host-env');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-host-env', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );
    const previousPreset = process.env.KOTA_PRESET;
    const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    const previousParentSecret = process.env.KOTA_PARENT_SECRET_LEAK_TEST;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.KOTA_PRESET = "claude";
    process.env.ANTHROPIC_API_KEY = "sk-active-preset-test";
    process.env.OPENAI_API_KEY = "sk-unrelated-provider-parent-test";
    process.env.KOTA_PARENT_SECRET_LEAK_TEST = "do-not-forward";
    process.env.NODE_OPTIONS = "--conditions=source --max-old-space-size=2048";
    try {
      const executor = createSubprocessExecutor({
        kotaBinaryPath: fakeKota,
        extraEnv: {
          KOTA_CALLER_SUPPLIED_SECRET: "explicit-forward",
        },
      });
      const outcome = await executor.execute({
        workflowName: "noop",
        workingDir: dirs.workingDir,
        budgetMs: 5_000,
      });

      expect(outcome.kind).toBe("completed");
      const envCapture = JSON.parse(
        readFileSync(join(dirs.workingDir, "host-env.json"), "utf8"),
      ) as Record<string, string>;
      expect(envCapture.home).toBe(dirs.workingDir);
      expect(envCapture.projectDir).toBe(dirs.workingDir);
      expect(envCapture.distDir).toBe(join(dirname(dirname(fakeKota)), "dist"));
      expect(envCapture.cacheDir).toBe(
        join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "cache"),
      );
      expect(envCapture.storeDir).toBe(
        join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "pnpm-store"),
      );
      expect(envCapture.path).toBe(process.env.PATH);
      expect(envCapture.nodeOptions).toBe("--max-old-space-size=2048");
      expect(envCapture.preset).toBe("claude");
      expect(envCapture.activeAuth).toBe("sk-active-preset-test");
      expect(envCapture.callerSupplied).toBe("explicit-forward");
      expect(envCapture.unrelatedProviderAuth).toBeUndefined();
      expect(envCapture.parentSecret).toBeUndefined();
    } finally {
      if (previousPreset === undefined) delete process.env.KOTA_PRESET;
      else process.env.KOTA_PRESET = previousPreset;
      if (previousAnthropicApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
      }
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
      if (previousParentSecret === undefined) {
        delete process.env.KOTA_PARENT_SECRET_LEAK_TEST;
      } else {
        process.env.KOTA_PARENT_SECRET_LEAK_TEST = previousParentSecret;
      }
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
    }
  });
});

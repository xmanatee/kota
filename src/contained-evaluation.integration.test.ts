// Catches loss of host authority/artifact attribution between native transport,
// the shared tool policy, and the eval module's existing runner.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ProcessResourceIdentity } from "#core/execution/process-supervisor.js";
import { assertModuleDefinition } from "#core/modules/module-definition.js";
import { registerTool } from "#core/tools/index.js";
import { withNativeToolExecution } from "#core/tools/native-tool-execution.js";
import {
  invokeNativeRunTool,
  startNativeRunAuthorization,
} from "#core/workflow/native-run-authorization.js";
import {
  CONTAINED_EVALUATION_PROFILES_ENV,
  containedEvaluationTool,
} from "#modules/eval-harness/contained-evaluation.js";
import { collectProbeSource } from "#modules/eval-harness/contained-probe.js";
import evalHarnessModule from "#modules/eval-harness/index.js";
import {
  createRepoTaskRuntimeSandbox,
  disposeRepoTaskRuntimeSandboxes,
  finishRepoTaskRuntimeSandbox,
} from "#modules/repo-tasks/repo-task-mutation-test-support.js";

const roots: string[] = [];
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  disposeRepoTaskRuntimeSandboxes();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// An explicit host-selected image exercises real Linux namespaces and Docker
// removal, copied native addons and executable mounts. No fake backend can turn
// this composition proof into a pass.
it.skipIf(!process.env.KOTA_TEST_CONTAINED_PROBE_IMAGE)("returns native Linux probe outcomes from current writer source and removes containers on cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "contained-linux-")); roots.push(root);
  const target = createRepoTaskRuntimeSandbox(root, "linux-run");
  const scopeId = deriveDirectoryScopeId(root);
  const workflow = { runId: "linux-run", workflowName: "builder", stepId: "build", spanId: "probe", scopeId };
  const marker = join(root, "host-only-marker"); writeFileSync(marker, "host only");
  // Large multibyte source crosses pipe chunks while every file remains below
  // the source collector's per-file limit. Hash the materialized bytes in Linux.
  const unicode = "é\ufffd🐙".repeat(10000);
  const unicodeHash = createHash("sha256").update(unicode).digest("hex");
  mkdirSync(join(target.workspaceRoot, "unicode"));
  for (let index = 0; index < 256; index++)
    writeFileSync(join(target.workspaceRoot, "unicode", `${index}.txt`), unicode);
  const source = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
assert.equal(process.platform, 'linux');
assert.equal(existsSync(${JSON.stringify(marker)}), false);
assert.equal(existsSync('/var/run/docker.sock'), false);
assert.equal(existsSync('/.dockerenv'), true);
assert.equal(process.env.KOTA_SYNTHETIC_HOST_SECRET, undefined);
assert.ok(Object.values(networkInterfaces()).flat().every(entry => entry.internal));
assert.throws(() => writeFileSync('/host-escape', 'denied'));
writeFileSync('inside', 'allowed'); assert.equal(readFileSync('inside', 'utf8'), 'allowed');
for (let index = 0; index < 256; index++) {
  assert.equal(createHash('sha256').update(readFileSync(join('unicode', index + '.txt'))).digest('hex'), '${unicodeHash}');
}
const require = createRequire(import.meta.url);
const addon = realpathSync(require.resolve('better-sqlite3/build/Release/better_sqlite3.node'));
assert.ok(addon.startsWith(join(process.cwd(), 'node_modules') + '/'));
const database = new Database(':memory:');
assert.deepEqual(database.prepare('SELECT 42 AS answer').get(), { answer: 42 });
database.close();
const executable = join(process.cwd(), 'copied-node');
copyFileSync(process.execPath, executable); chmodSync(executable, 0o755);
assert.equal(execFileSync(executable, ['--eval', "process.stdout.write('COPIED_EXECUTABLE_PASSED')"], { encoding: 'utf8' }), 'COPIED_EXECUTABLE_PASSED');
console.log('LINUX_CURRENT_WRITER_PROBE_PASSED');`;
  writeFileSync(join(target.workspaceRoot, "probe.mjs"), source);
  writeFileSync(join(target.workspaceRoot, "package.json"), JSON.stringify({ name: "contained-probe-smoke", scripts: { probe: "node probe.mjs", wait: "node -e 'setInterval(() => {}, 1000)'" } }));
  const sourcePaths = ["package.json", "probe.mjs", "unicode"];
  const expectedSource = await collectProbeSource(target.workspaceRoot, sourcePaths, new AbortController().signal);
  // A different canonical file catches accidental evaluation of scopeRoot.
  writeFileSync(join(root, "probe.mjs"), "throw new Error('stale canonical source');");
  vi.stubEnv("KOTA_SYNTHETIC_HOST_SECRET", "synthetic-host-only");
  vi.stubEnv(CONTAINED_EVALUATION_PROFILES_ENV, JSON.stringify({ linux: {
    scopeRoots: [root], timeoutMs: 60000, cpuCores: 2, memoryMB: 2048,
    isolationBackend: { kind: "container", executable: "docker", image: process.env.KOTA_TEST_CONTAINED_PROBE_IMAGE, kotaBinaryPath: "/opt/kota/bin/kota.mjs" },
    probes: {
      smoke: { command: "pnpm run probe", sourcePaths },
      wait: { command: "pnpm run wait", sourcePaths: ["package.json"] },
    },
  } }));
  const tool = containedEvaluationTool;
  disposers.push(registerTool(tool.tool, tool.runner, "eval-harness", { effect: tool.effect!, nativeInvocation: true, resolveFilesystemTargets: tool.resolveFilesystemTargets }));
  const resources: ProcessResourceIdentity[] = [];
  const env = { KOTA_RUN_ID: workflow.runId, KOTA_RUN_ATTEMPT: "1", KOTA_DAEMON_EPOCH: "1", KOTA_RUN_STATE_DIR: join(root, ".kota") };
  const policy = resolveScopePolicy({
    projection: { rootScopeId: scopeId, defaultScopeId: scopeId, scopes: [{ scopeId, displayName: "Linux smoke", directoryRoot: root }] }, scopeId,
    fragments: [{ scopeId, reason: "contained smoke", externalEffects: { networkRead: "allow" } }],
  });
  await withNativeToolExecution({
    prompt: "Exercise contained verification", effort: "low", cwd: target.workspaceRoot, scopeRoot: root,
    workflowContext: workflow, agentOutputDir: target.workspaceRoot, autonomyMode: "autonomous", agentWriteScope: "deny-all", scopePolicy: policy,
    onProcessSpawn: (identity) => { if ("kind" in identity) resources.push(identity); },
  }, async () => {
    const service = startNativeRunAuthorization(target.workspaceRoot, env, [target.workspaceRoot])!;
    const call = (probeId: string, signal?: AbortSignal) => invokeNativeRunTool(target.workspaceRoot, "contained_evaluation", { operation: "probe", profile: "linux", probeId }, signal, { ...env, ...service.env });
    const inspect = (resource: ProcessResourceIdentity) => {
      if (resource.cleanup.kind !== "command") throw new Error("Expected a container resource");
      return spawnSync("docker", ["inspect", resource.cleanup.args.at(-1)!], { encoding: "utf8", timeout: 5000 });
    };
    try {
      const returned = await call("smoke");
      expect(returned.is_error, returned.content).not.toBe(true);
      const result = JSON.parse(returned.content);
      expect(result.origin).toEqual(workflow);
      expect(result.result.output).toContain("LINUX_CURRENT_WRITER_PROBE_PASSED");
      expect(result.result.sourceDigest).toBe(expectedSource.digest);
      expect(inspect(resources.at(-1)!).status).not.toBe(0);
      const count = resources.length;
      const abort = new AbortController();
      const cancelled = call("wait", abort.signal).catch((error: Error) => error);
      await vi.waitFor(() => { expect(resources.length).toBeGreaterThan(count); expect(inspect(resources.at(-1)!).status).toBe(0); }, { timeout: 15000 });
      abort.abort();
      await cancelled;
      // close awaits the host invocation's final cleanup barrier.
      await service.close();
      expect(inspect(resources.at(-1)!).status).not.toBe(0);
      expect(readFileSync(marker, "utf8")).toBe("host only");
    } finally { await service.close(); }
  });
}, 120000);
it("invokes only the authorized host profile, returns attributable runner failure, and respects revocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "contained-eval-boundary-"));
  roots.push(root);
  const target = createRepoTaskRuntimeSandbox(root, "contained-run");
  const scopeId = deriveDirectoryScopeId(root);
  const workflow = {
    runId: "contained-run",
    workflowName: "builder",
    stepId: "build",
    spanId: "eval-call",
    scopeId,
  };
  assertModuleDefinition(evalHarnessModule);
  const tool = containedEvaluationTool;
  disposers.push(
    registerTool(tool.tool, tool.runner, "eval-harness", {
      effect: tool.effect!,
      nativeInvocation: tool.nativeInvocation,
      resolveFilesystemTargets: tool.resolveFilesystemTargets,
    }),
  );
  disposers.push(
    registerAgentHarness({
      name: "codex",
      description: "external harness port",
      toolControl: "native",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      run: async () => {
        throw new Error("No model should run for missing fixture evidence");
      },
    }),
  );
  vi.stubEnv(
    CONTAINED_EVALUATION_PROFILES_ENV,
    JSON.stringify({
      bounded: {
        scopeRoots: [root],
        preset: "codex",
        fixtureIds: ["absent-boundary-fixture"],
        maxRepeats: 1,
        timeoutMs: 10000,
        cpuCores: 1,
        memoryMB: 512,
        isolationBackend: {
          kind: "container",
          executable: "docker",
          image: "kota-eval:approved",
          kotaBinaryPath: "/opt/kota/bin/kota.mjs",
          networkPolicy: {
            kind: "provider-egress",
            provider: "openai",
            enforcement: {
              kind: "docker-internal-proxy",
              networkName: "eval-internal",
              proxyUrl: "http://proxy:3128",
            },
          },
        },
      },
      linux: {
        scopeRoots: [root], timeoutMs: 10000, cpuCores: 1, memoryMB: 512,
        probes: { persistence: { command: "pnpm test", sourcePaths: ["src"] } },
        isolationBackend: { kind: "container", executable: "kota-missing-probe-backend", image: "kota:probe", kotaBinaryPath: "/opt/kota/bin/kota.mjs" },
      },
    }),
  );
  let networkAllowed = true;
  const policy = () =>
    resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: scopeId,
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId,
            displayName: "Eval",
            parentScopeId: "global",
            directoryRoot: root,
          },
        ],
      },
      scopeId,
      fragments: [
        {
          scopeId,
          reason: "Host-authorized evaluation",
          writes: { mode: "paths", paths: ["src/"] },
          externalEffects: { networkRead: networkAllowed ? "allow" : "deny" },
        },
      ],
    });
  const env = {
    KOTA_RUN_ID: workflow.runId,
    KOTA_RUN_ATTEMPT: "1",
    KOTA_DAEMON_EPOCH: "1",
    KOTA_RUN_STATE_DIR: join(root, ".kota"),
  };
  await withNativeToolExecution(
    {
      prompt: "Evaluate the admitted task",
      effort: "low",
      cwd: target.workspaceRoot,
      scopeRoot: root,
      workflowContext: workflow,
      agentOutputDir: target.workspaceRoot,
      autonomyMode: "autonomous",
      agentWriteScope: "deny-all",
      onProcessSpawn: () => {
        throw new Error("Missing fixture must fail before subprocess launch");
      },
      getScopePolicySnapshot: () => ({ policy: policy(), revision: 1 }),
    },
    async () => {
      const service = startNativeRunAuthorization(target.workspaceRoot, env, [
        target.workspaceRoot,
      ])!;
      const childEnv = { ...env, ...service.env };
      const call = (
        input: Record<string, unknown>,
        name = "contained_evaluation",
      ) =>
        invokeNativeRunTool(
          target.workspaceRoot,
          name,
          input,
          undefined,
          childEnv,
        );
      try {
        const inspection = await call({ operation: "inspect" });
        expect(inspection.is_error, inspection.content).not.toBe(true);
        expect(
          JSON.parse(inspection.content).profiles.bounded.isolationBackend
            .image,
        ).toBe("kota-eval:approved");
        expect(await call({ operation: "inspect" }, "shell")).toMatchObject({
          is_error: true,
          content: expect.stringContaining("unavailable through native"),
        });
        for (const input of [
          {
            operation: "run",
            profile: "bounded",
            fixtureIds: ["absent-boundary-fixture"],
            isolationBackend: { executable: "sh" },
          },
          {
            operation: "run",
            profile: "bounded",
            fixtureIds: ["unauthorized"],
          },
          {
            operation: "run",
            profile: "bounded",
            fixtureIds: ["absent-boundary-fixture"],
            repeatCount: 2,
          },
        ])
          expect(await call(input)).toMatchObject({ is_error: true });
        const returned = await call({
          operation: "run",
          profile: "bounded",
          fixtureIds: ["absent-boundary-fixture"],
        });
        expect(returned.is_error).toBe(true);
        const result = JSON.parse(returned.content);
        expect(result.origin).toEqual(workflow);
        expect(result.result).toMatchObject({
          ok: false,
          reason: "fixture_provenance",
        });
        expect(result.artifactDir).toContain("/native-tool-artifacts/");
        expect(
          service.writeProtectedRoots.some((path) =>
            result.artifactDir.startsWith(`${path}/`),
          ),
        ).toBe(true);
        expect(
          JSON.parse(
            readFileSync(join(result.artifactDir, "request.json"), "utf8"),
          ).origin,
        ).toEqual(workflow);
        expect(
          JSON.parse(
            readFileSync(join(result.artifactDir, "result.json"), "utf8"),
          ),
        ).toEqual(result.result);
        expect(existsSync(join(root, ".kota/eval-runs"))).toBe(false);
        for (const input of [
          { operation: "probe", profile: "linux", probeId: "ungranted" },
          { operation: "probe", profile: "linux", probeId: "persistence", command: "sh" },
          { operation: "probe", profile: "linux", probeId: "persistence", sourceRoot: root },
        ]) expect(await call(input)).toMatchObject({ is_error: true });
        const probe = await call({ operation: "probe", profile: "linux", probeId: "persistence" });
        expect(probe.is_error).toBe(true);
        const failedProbe = JSON.parse(probe.content);
        expect(failedProbe.origin).toEqual(workflow);
        expect(failedProbe.error).toContain("kota-missing-probe-backend");
        expect(failedProbe.error).toContain("unavailable");
        expect(JSON.parse(readFileSync(join(failedProbe.artifactDir, "failure.json"), "utf8")).cancelled).toBe(false);
        networkAllowed = false;
        expect(await call({ operation: "inspect" })).toMatchObject({
          is_error: true,
          content: expect.stringContaining("scope policy"),
        });
        networkAllowed = true;
        finishRepoTaskRuntimeSandbox(target.workspaceRoot);
        expect(await call({ operation: "inspect" })).toMatchObject({
          is_error: true,
        });
      } finally {
        await service.close();
      }
    },
  );
});

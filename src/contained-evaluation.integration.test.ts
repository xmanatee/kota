// Catches loss of host authority/artifact attribution between native transport,
// the shared tool policy, and the eval module's existing runner.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
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

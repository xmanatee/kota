import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Readable, Writable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessResult,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { Daemon } from "#core/daemon/daemon.js";
import {
  type DaemonControlAddress,
  DaemonControlServer,
} from "#core/daemon/daemon-control.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { scopeAuthorityOperatorTokenPath } from "#core/daemon/scope-authority-operator-token.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import {
  resetActiveKotaClient,
  setActiveKotaClient,
} from "#core/server/client-holder.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import type {
  DaemonRawRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import { setSkipConfirmations } from "#core/util/confirm.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { buildScopeCommand } from "#modules/daemon-ops/scopes-cli.js";
import {
  setStderrTransport,
  setTerminalTransport,
  TerminalTransport,
} from "#modules/rendering/transport.js";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildWorkflowCommand } from "#modules/workflow-ops/index.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

const ACCEPTANCE_HARNESS = "scope-onboarding-acceptance";
const TARGET_WORKFLOWS = new Set([
  "builder",
  "daily-digest",
  "dispatcher",
  "scope-improvement-actions",
  "scope-improvement-onboarding",
  "scope-improvement-publication",
  "scope-improver",
]);
type RunningDaemon = {
  daemon: Daemon;
  loader: Awaited<ReturnType<typeof loadRuntimeModules>>;
  client: KotaClient;
  startPromise: Promise<void>;
};

type CliTranscriptEntry = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type InProcessControlDispatcher = {
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
};

function responseHeaderValue(value: number | string | readonly string[]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

async function dispatchControlRequest(
  server: DaemonControlServer,
  token: string,
  method: string,
  path: string,
  init: DaemonRawRequestInit = {},
): Promise<Response> {
  const suppliedHeaders = new Headers(init.headers);
  if (!suppliedHeaders.has("authorization")) {
    suppliedHeaders.set("authorization", `Bearer ${token}`);
  }
  const requestHeaders: Record<string, string> = {};
  suppliedHeaders.forEach((value, name) => {
    requestHeaders[name.toLowerCase()] = value;
  });
  const requestBody = init.body === undefined || init.body === null
    ? []
    : [Buffer.from(String(init.body))];
  const req = Object.assign(Readable.from(requestBody), {
    headers: requestHeaders,
    method,
    url: path,
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;

  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    const chunks: Buffer[] = [];
    const headers = new Headers();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    }) as unknown as ServerResponse;
    res.statusCode = 200;
    let headersSent = false;
    Object.defineProperty(res, "headersSent", {
      configurable: true,
      get: () => headersSent,
    });
    res.setHeader = (name, value) => {
      headers.set(name, responseHeaderValue(value));
      return res;
    };
    res.getHeader = (name) => headers.get(name) ?? undefined;
    res.hasHeader = (name) => headers.has(name);
    res.removeHeader = (name) => headers.delete(name);
    res.writeHead = ((statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: unknown) => {
      res.statusCode = statusCode;
      headersSent = true;
      const rawHeaders = typeof reasonOrHeaders === "object" && reasonOrHeaders !== null
        ? reasonOrHeaders
        : maybeHeaders;
      if (typeof rawHeaders === "object" && rawHeaders !== null) {
        for (const [name, value] of Object.entries(rawHeaders)) {
          if (value !== undefined) headers.set(name, responseHeaderValue(value));
        }
      }
      return res;
    }) as ServerResponse["writeHead"];
    res.once("finish", () => {
      resolveResponse(new Response(Buffer.concat(chunks), {
        status: res.statusCode,
        headers,
      }));
    });
    res.once("error", rejectResponse);
    try {
      (server as unknown as InProcessControlDispatcher).handleRequest(req, res);
    } catch (error) {
      rejectResponse(error);
    }
  });
}

function createInProcessDaemonTransport(
  server: DaemonControlServer,
  token: string,
): DaemonTransport {
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const fetchRaw = (path: string, init: DaemonRawRequestInit = {}) => {
    return dispatchControlRequest(server, token, init.method ?? "GET", path, init);
  };
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders,
    async request<T>(method: string, path: string, body?: unknown) {
      try {
        const response = await fetchRaw(path, {
          method,
          headers: { "Content-Type": "application/json", ...authHeaders() },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok || response.status === 204) return null;
        return await response.json() as T;
      } catch {
        return null;
      }
    },
    async requestStrict<T>(method: string, path: string, body?: unknown) {
      const response = await fetchRaw(path, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    },
    fetchRaw,
    async *events() {
      yield* [];
    },
  };
}

function successfulHarnessResult(text: string): AgentHarnessResult {
  return {
    text,
    streamedText: text,
    turns: 1,
    usage: {
      tokens: { state: "unknown" },
      cost: { state: "unknown" },
    },
    isError: false,
  };
}

function createAcceptanceHarness(args: {
  ready: () => boolean;
  taskId: () => string;
  onBuilderEntered: () => void;
  waitForBuilderRelease: () => Promise<void>;
}): AgentHarness {
  return {
    name: ACCEPTANCE_HARNESS,
    description: "Deterministic provider boundary for the external-scope acceptance journey",
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: "ask_owner",
    emitsAgentMessageStream: true,
    toolControl: "kota",
    readiness: () => args.ready()
      ? {
          adapterKind: "unknown",
          localRuntime: {
            kind: "node-runtime",
            status: "ready",
            required: true,
            version: process.version,
            summary: "Acceptance provider is ready.",
          },
          optionalRuntimes: [],
          unsupportedOptions: [],
        }
      : {
          adapterKind: "unknown",
          localRuntime: {
            kind: "native-cli",
            status: "missing",
            required: true,
            command: "scope-onboarding-acceptance",
            binaryName: "scope-onboarding-acceptance",
            summary: "Acceptance provider is intentionally unavailable.",
          },
          optionalRuntimes: [],
          unsupportedOptions: [],
        },
    async run(options): Promise<AgentHarnessResult> {
      if (options.systemPrompt?.includes("independent code review critic")) {
        return successfulHarnessResult(JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "The fixture task is terminal and the scoped file effect is present.",
        }));
      }
      if (options.workflowContext?.workflowName !== "builder") {
        throw new Error(
          `Acceptance harness received unexpected workflow ${options.workflowContext?.workflowName}`,
        );
      }
      if (!options.cwd) throw new Error("Builder acceptance run has no workspace");
      args.onBuilderEntered();
      await args.waitForBuilderRelease();

      moveTaskById(options.cwd, args.taskId(), "done");
      writeFileSync(
        join(options.cwd, "AGENTS.md"),
        [
          "# Acceptance code scope",
          "",
          "This repository proves scope-local onboarding and task-backed improvement.",
          "Keep changes inside this repository and preserve operator-owned inbox files.",
          "",
        ].join("\n"),
      );
      if (options.agentOutputDir) {
        mkdirSync(options.agentOutputDir, { recursive: true });
        writeFileSync(
          join(options.agentOutputDir, "commit-message.txt"),
          "Complete external-scope acceptance improvement\n",
        );
      }
      return successfulHarnessResult(
        "Completed the assigned task and verified the scoped file effect.",
      );
    },
  };
}

function initializeCodeFixture(root: string): void {
  mkdirSync(join(root, "data", "tasks", "archive"), { recursive: true });
  mkdirSync(join(root, "data", "inbox"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "scope-onboarding-code-acceptance",
      private: true,
      scripts: {
        "check:fast": "node -e \"process.exit(0)\"",
        "validate-tasks": "node -e \"process.exit(0)\"",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(join(root, "data", "inbox", "keep.md"), "operator-owned\n");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=KOTA Acceptance",
      "-c",
      "user.email=acceptance@kota.invalid",
      "commit",
      "--quiet",
      "-m",
      "Initial acceptance scope",
    ],
    { cwd: root },
  );
}

function initializeObserveFixture(root: string): void {
  mkdirSync(join(root, ".kota"), { recursive: true });
  writeFileSync(join(root, "notes.txt"), "An owner-maintained non-code folder.\n");
  writeFileSync(
    join(root, ".kota", "config.json"),
    `${JSON.stringify({
      trustedScopes: ["/"],
      scopePolicies: [{ scopeId: "*", writes: { mode: "unrestricted" } }],
      scopeAuthority: { revision: 999, audit: [] },
    }, null, 2)}\n`,
  );
}

function directoryHash(root: string, directory = root): string {
  const hash = createHash("sha256");
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const rel = relative(root, path);
      // Runtime-owned run data can advance while a sibling scope stays live.
      // Retain the scope-owned config in the oracle so removal cannot conceal
      // changes to an owner-authored or malicious .kota/config.json.
      if (relative(root, current) === ".kota" && name !== "config.json") continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        hash.update(`link:${rel}:${readlinkSync(path)}\0`);
      } else if (stat.isDirectory()) {
        hash.update(`dir:${rel}\0`);
        visit(path);
      } else if (stat.isFile()) {
        hash.update(`file:${rel}\0`);
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function productionSourceMatches(pattern: string): string[] {
  try {
    return execFileSync(
      "rg",
      [
        "-l",
        "--glob",
        "*.ts",
        "--glob",
        "!*.test.ts",
        "--glob",
        "!*.integration.test.ts",
        pattern,
        "src",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim().split("\n").filter(Boolean).sort();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 1
    ) return [];
    throw error;
  }
}

async function waitFor<T>(read: () => Promise<T> | T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  let last = await read();
  while (!accept(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    last = await read();
  }
  expect(accept(last), JSON.stringify(last, null, 2)).toBe(true);
  return last;
}

describe("self-service external scope onboarding acceptance", () => {
  let root: string;
  let hostRoot: string;
  let codeRoot: string;
  let observeRoot: string;
  let aliasRoot: string;
  let recoveryRoot: string;
  let missingSetupRoot: string;
  let machineDir: string;
  let authorityConfigPath: string;
  let operatorTokenPath: string;
  let current: RunningDaemon | null;
  let startedControlServer: DaemonControlServer | null;
  let controlServerStartSpy: { mockRestore(): void };
  let runResourceAllocateSpy: { mockRestore(): void };
  let harnessReady: boolean;
  let releaseBuilder: () => void;
  let builderEntered: Promise<void>;
  let resolveBuilderEntered: () => void;
  let generatedTaskId: string | null;
  let priorOperatorTokenPath: string | undefined;
  let priorSessionId: string | undefined;
  let ttyDescriptor: PropertyDescriptor | undefined;
  const events: BusEnvelope[] = [];
  const transcript: CliTranscriptEntry[] = [];

  beforeEach(() => {
    resetScheduler();
    events.splice(0);
    transcript.splice(0);
    root = mkdtempSync(join(tmpdir(), "kota-scope-onboarding-e2e-"));
    hostRoot = join(root, "host");
    codeRoot = join(root, "code-scope");
    observeRoot = join(root, "observe-scope");
    aliasRoot = join(root, "code-scope-alias");
    recoveryRoot = join(root, "recovery-scope");
    missingSetupRoot = join(root, "missing-setup-scope");
    machineDir = join(root, "machine");
    authorityConfigPath = join(machineDir, "config.json");
    operatorTokenPath = scopeAuthorityOperatorTokenPath(authorityConfigPath);
    mkdirSync(join(hostRoot, ".kota"), { recursive: true });
    mkdirSync(machineDir, { recursive: true });
    initializeCodeFixture(codeRoot);
    initializeObserveFixture(observeRoot);
    initializeObserveFixture(recoveryRoot);
    initializeCodeFixture(missingSetupRoot);
    symlinkSync(codeRoot, aliasRoot, "dir");

    harnessReady = true;
    generatedTaskId = null;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    releaseBuilder = release;
    let entered!: () => void;
    builderEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    resolveBuilderEntered = entered;
    registerAgentHarness(createAcceptanceHarness({
      ready: () => harnessReady,
      taskId: () => {
        if (generatedTaskId === null) throw new Error("Generated task id is unavailable");
        return generatedTaskId;
      },
      onBuilderEntered: () => resolveBuilderEntered(),
      waitForBuilderRelease: () => released,
    }));

    priorOperatorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    priorSessionId = process.env.KOTA_SESSION_ID;
    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = operatorTokenPath;
    delete process.env.KOTA_SESSION_ID;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    current = null;
    startedControlServer = null;
    controlServerStartSpy = vi
      .spyOn(DaemonControlServer.prototype, "start")
      .mockImplementation(function (this: DaemonControlServer) {
        startedControlServer = this;
        return Promise.resolve(0);
      });
    const allocateRunResources = RunResourceAllocator.prototype.allocate;
    runResourceAllocateSpy = vi
      .spyOn(RunResourceAllocator.prototype, "allocate")
      .mockImplementation(function (this: RunResourceAllocator, ...args) {
        // This sandbox rejects every loopback bind. Preserve the production
        // allocator and its durable resource claims while replacing only its
        // operating-system availability probe.
        (this as unknown as { isPortAvailable: (port: number) => Promise<boolean> })
          .isPortAvailable = async () => true;
        return allocateRunResources.apply(this, args);
      });
    setSkipConfirmations(true);
  });

  afterEach(async () => {
    releaseBuilder();
    chmodSync(machineDir, 0o700);
    if (current) await stopDaemon(current);
    controlServerStartSpy.mockRestore();
    runResourceAllocateSpy.mockRestore();
    setSkipConfirmations(false);
    resetActiveKotaClient();
    setTerminalTransport(null);
    setStderrTransport(null);
    resetScheduler();
    if (ttyDescriptor === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    if (priorOperatorTokenPath === undefined) {
      delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    } else {
      process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorOperatorTokenPath;
    }
    if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
    else process.env.KOTA_SESSION_ID = priorSessionId;
    rmSync(root, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<RunningDaemon> {
    const config = loadConfig(
      hostRoot,
      {
        defaultAgentHarness: ACCEPTANCE_HARNESS,
        defaultPreset: "codex",
      },
      { globalConfigPath: authorityConfigPath },
    );
    const eventBus = new EventBus();
    eventBus.on("*", (event) => events.push(event));
    const loader = await loadRuntimeModules({
      config,
      cwd: hostRoot,
      eventBus,
      globalConfigPath: authorityConfigPath,
    });
    const daemon = new Daemon({
      runtimeModuleHost: { eventBus, moduleLoader: loader },
      scopeRoot: hostRoot,
      stateDir: join(hostRoot, ".kota"),
      authorityConfigPath,
      config,
      idleIntervalMs: 500,
      pollIntervalMs: 60_000,
      workflows: loader.getContributedWorkflows().filter((workflow) =>
        TARGET_WORKFLOWS.has(workflow.name)
      ),
      channels: [],
      controlRoutes: loader.getContributedControlRoutes(),
      routes: loader.getRoutes(),
      getModuleSummaries: () => loader.getModuleSummaries(),
      resolveAgentDef: (name) => loader.getAgentDef(name),
      resolveSkillsPrompt: (names, agentName) => loader.getSkillsPromptFor(names, agentName),
      probeModuleHealthChecks: () => loader.probeHealthChecks(),
      moduleConfigKeys: loader.getRegisteredConfigKeys(),
    });
    const startPromise = daemon.start();
    await daemon.whenReady();
    const controlServer = startedControlServer;
    if (controlServer === null) {
      throw new Error("Daemon startup did not initialize its control route dispatcher");
    }
    const address = JSON.parse(
      readFileSync(join(hostRoot, ".kota", "daemon-control.json"), "utf8"),
    ) as DaemonControlAddress;
    const transport = createInProcessDaemonTransport(controlServer, address.token);
    const client = DaemonControlClient.fromTransport(
      transport,
      loader.assembleDaemonClientHandlers(transport),
    );
    setActiveKotaClient(client);
    current = { daemon, loader, client, startPromise };
    return current;
  }

  async function stopDaemon(subject: RunningDaemon): Promise<void> {
    await subject.daemon.stop(2_000, "programmatic", 2_000);
    await subject.startPromise;
    await subject.loader.unloadAll();
    if (current === subject) current = null;
  }

  async function runCli(args: string[], _input = ""): Promise<CliTranscriptEntry> {
    if (current === null) throw new Error("CLI acceptance command requires a running daemon");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutTransport = new TerminalTransport({
      stream: {
        write: (chunk) => {
          stdout.push(chunk);
          return true;
        },
        isTTY: false,
      },
    });
    const stderrTransport = new TerminalTransport({
      stream: {
        write: (chunk) => {
          stderr.push(chunk);
          return true;
        },
        isTTY: false,
      },
    });
    setTerminalTransport(stdoutTransport);
    setStderrTransport(stderrTransport);
    const priorExitCode = process.exitCode;
    process.exitCode = undefined;
    const ctx = { client: current.client, cwd: hostRoot } as ModuleContext;
    const program = new Command("kota").exitOverride();
    if (args[0] === "scope") program.addCommand(buildScopeCommand(ctx));
    else if (args[0] === "workflow") program.addCommand(buildWorkflowCommand(ctx));
    else throw new Error(`Unsupported acceptance CLI command: ${args[0] ?? "missing"}`);
    try {
      await program.parseAsync(["node", "kota", ...args]);
    } finally {
      setTerminalTransport(null);
      setStderrTransport(null);
    }
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.exitCode = priorExitCode;
    const entry = {
      command: `kota ${args.join(" ")}`,
      exitCode,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    };
    transcript.push(entry);
    return entry;
  }

  it("adds code and non-code scopes, activates work, recovers, isolates, and removes safely", async () => {
    let running = await startDaemon();
    const hostScopeId = deriveDirectoryScopeId(hostRoot);
    const codeScopeId = deriveDirectoryScopeId(codeRoot);
    const observeScopeId = deriveDirectoryScopeId(observeRoot);
    const recoveryScopeId = deriveDirectoryScopeId(recoveryRoot);
    const observeConfigBefore = readFileSync(join(observeRoot, ".kota", "config.json"));
    const scopesBeforeAdd = await running.client.scopes.list();

    const inspectedCode = await runCli(["scope", "inspect", codeRoot, "--json"]);
    expect(inspectedCode.exitCode, inspectedCode.stderr).toBe(0);
    expect(JSON.parse(inspectedCode.stdout)).toMatchObject({
      ok: true,
      inspection: { registered: false, kind: "git-repository" },
    });
    const configuredCode = await runCli([
      "scope",
      "configure",
      codeRoot,
      "--name",
      "Acceptance code",
      "--trusted",
      "--improvement",
      "propose",
      "--writes",
      "scope-directory",
      "--json",
    ]);
    expect(configuredCode.exitCode, configuredCode.stderr).toBe(0);
    expect(JSON.parse(configuredCode.stdout)).toMatchObject({
      ok: true,
      plan: {
        permissions: {
          improvement: { posture: "propose", review: "task-proposals" },
        },
      },
    });
    const addedCode = await runCli([
      "scope",
      "add",
      codeRoot,
      "--name",
      "Acceptance code",
      "--trusted",
      "--improvement",
      "propose",
      "--writes",
      "scope-directory",
      "--json",
    ], "y\n");
    expect(addedCode.exitCode, addedCode.stderr).toBe(0);
    expect(JSON.parse(addedCode.stdout), addedCode.stdout).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: {
          registered: true,
          workflowReady: true,
          improvement: { posture: "propose", builder: "disabled" },
        },
      },
    });

    const codeInspection = await running.client.scopes.inspectOnboarding(codeRoot);
    expect(codeInspection).toMatchObject({ ok: true });
    if (!codeInspection.ok) return;
    expect(codeInspection.inspection.setup.some((entry) => entry.state === "missing")).toBe(true);
    const codeOperationId = codeInspection.inspection.operationId;
    expect(await running.client.scopes.getOnboardingStatus(codeOperationId)).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: { registered: true, workflowReady: true, blocked: false },
      },
    });
    const untrustedSiblingAfterCodeTrust = await running.client.scopes.inspectOnboarding(
      recoveryRoot,
    );
    expect(untrustedSiblingAfterCodeTrust).toMatchObject({
      ok: true,
      inspection: {
        scopeId: recoveryScopeId,
        registered: false,
        trust: null,
        policyFragment: null,
        policy: null,
      },
    });

    const completedCodeImprovement = await waitFor(
      () => running.client.forScope(codeScopeId).workflow.listRuns({
        workflow: "scope-improver",
      }),
      (result) => result.runs.some((run) => run.status === "success"),
    );
    const generatedTasks = await waitFor(
      () => readdirSync(join(codeRoot, "data", "tasks")),
      (entries) => entries.some((entry) => /^task-.*\.md$/.test(entry)),
    );
    generatedTaskId = generatedTasks.find((entry) => /^task-.*\.md$/.test(entry))!
      .replace(/\.md$/, "");
    const proposedTask = readFileSync(
      join(codeRoot, "data", "tasks", `${generatedTaskId}.md`),
      "utf8",
    );
    expect(proposedTask).toContain("# Add scope guidance for code-scope");
    expect(proposedTask).toContain("Created by scope-improver workflow run");

    const addedObserve = await runCli([
      "scope",
      "add",
      observeRoot,
      "--name",
      "Acceptance notes",
      "--trusted",
      "--improvement",
      "observe",
      "--writes",
      "none",
      "--json",
    ], "y\n");
    expect(addedObserve.exitCode, addedObserve.stderr).toBe(0);
    expect(JSON.parse(addedObserve.stdout)).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: {
          workflowReady: true,
          improvement: { posture: "observe", review: "owner-questions" },
        },
      },
    });
    const observeInspection = await running.client.scopes.inspectOnboarding(observeRoot);
    expect(observeInspection).toMatchObject({ ok: true });
    if (!observeInspection.ok) return;
    const observeOperationId = observeInspection.inspection.operationId;
    const completedObserveImprovement = await waitFor(
      () => running.client.forScope(observeScopeId).workflow.listRuns({
        workflow: "scope-improver",
      }),
      (result) => result.runs.some((run) => run.status === "success"),
    );
    await waitFor(
      () => running.client.forScope(observeScopeId).workflow.listRuns({
        workflow: "scope-improvement-publication",
      }),
      (result) => result.runs.some((run) => run.status === "success"),
    );
    const observeQuestions = await waitFor(
      () => running.client.forScope(observeScopeId).ownerQuestions.list({ status: "pending" }),
      (result) => result.questions.some((item) => item.source === "scope-improver"),
    );
    expect(observeQuestions.questions).toHaveLength(1);
    expect(existsSync(join(observeRoot, "data", "tasks"))).toBe(false);

    const aliasInspection = await running.client.scopes.inspectOnboarding(aliasRoot);
    expect(aliasInspection).toMatchObject({
      ok: true,
      inspection: {
        scopeId: codeScopeId,
        directoryRoot: codeRoot,
        registered: true,
      },
    });
    const duplicate = await runCli([
      "scope",
      "add",
      aliasRoot,
      "--name",
      "Acceptance code",
      "--trusted",
      "--improvement",
      "propose",
      "--writes",
      "scope-directory",
      "--json",
    ]);
    expect(duplicate.exitCode, duplicate.stderr).toBe(0);
    expect(JSON.parse(duplicate.stdout)).toMatchObject({
      ok: true,
      inspection: { scopeId: codeScopeId, directoryRoot: codeRoot, registered: true },
      operation: { operationId: codeOperationId, attempts: 1 },
    });

    const selected = await runCli(["scope", "select", codeScopeId, "--json"]);
    expect(selected.exitCode, selected.stderr).toBe(0);
    expect(await running.client.scopes.list()).toMatchObject({
      ok: true,
      activeScopeId: codeScopeId,
    });

    const upgraded = await runCli([
      "scope",
      "authority",
      "set",
      codeScopeId,
      "--policy",
      JSON.stringify({
        scopeId: codeScopeId,
        reason: "Owner accepted the proposed onboarding task for autonomous implementation",
        autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
        writes: { mode: "scope-directory" },
      }),
      "--reason",
      "Accept the onboarding-generated task for autonomous implementation",
      "--json",
    ], "y\n");
    expect(upgraded.exitCode, upgraded.stderr).toBe(0);
    expect(JSON.parse(upgraded.stdout)).toMatchObject({ ok: true });

    await builderEntered;
    const activeCodeStatus = await running.client.forScope(codeScopeId).workflow.status();
    expect(activeCodeStatus.activeRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ workflow: "builder" }),
    ]));
    expect(existsSync(join(observeRoot, "cross-scope-write.txt"))).toBe(false);
    const busyDrain = await runCli(["scope", "drain", codeScopeId, "--json"], "y\n");
    expect(busyDrain.exitCode).toBe(1);
    expect(JSON.parse(busyDrain.stdout)).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([
        expect.objectContaining({ kind: "active_run" }),
        expect.objectContaining({
          kind: "resource_lease",
          ids: expect.arrayContaining([expect.stringContaining(`task:${generatedTaskId}`)]),
        }),
      ]),
    });
    const busyRemove = await runCli(["scope", "remove", codeScopeId, "--json"], "y\n");
    expect(busyRemove.exitCode).toBe(1);
    expect(JSON.parse(busyRemove.stdout)).toMatchObject({
      ok: false,
      reason: "scope_not_drained",
    });
    expect(
      (await running.client.forScope(codeScopeId).ownerQuestions.list({ status: "pending" }))
        .questions,
    ).toEqual([]);

    const codeAuthority = await running.client.scopes.inspectAuthority(codeScopeId);
    const observeAuthority = await running.client.scopes.inspectAuthority(observeScopeId);
    expect(codeAuthority).toMatchObject({
      ok: true,
      authority: {
        trust: { trusted: true },
        resolvedPolicy: {
          autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
          writes: { mode: "scope-directory" },
        },
      },
    });
    expect(observeAuthority).toMatchObject({
      ok: true,
      authority: {
        trust: { trusted: true },
        resolvedPolicy: {
          autonomy: { defaultMode: "passive", maxMode: "passive" },
          writes: { mode: "none" },
        },
      },
    });
    expect(JSON.parse(readFileSync(join(observeRoot, ".kota", "config.json"), "utf8")))
      .toMatchObject({
        trustedScopes: ["/"],
        scopePolicies: [{ scopeId: "*", writes: { mode: "unrestricted" } }],
        scopeAuthority: { revision: 999 },
      });
    expect(readFileSync(authorityConfigPath, "utf8")).not.toContain('"revision": 999');

    releaseBuilder();
    const completedBuilderRuns = await waitFor(
      () => running.client.forScope(codeScopeId).workflow.listRuns({ workflow: "builder" }),
      (result) => result.runs.some((run) =>
        run.status === "success" || run.status === "completed-with-warnings"
      ),
    );
    expect(completedBuilderRuns.runs).toHaveLength(1);
    await waitFor(
      () => ({
        guidance: existsSync(join(codeRoot, "AGENTS.md")),
        task: existsSync(join(
          codeRoot,
          "data",
          "tasks",
          "archive",
          `${generatedTaskId}.md`,
        )),
      }),
      (result) => result.guidance && result.task,
    );
    expect(readFileSync(join(codeRoot, "AGENTS.md"), "utf8"))
      .toContain("This repository proves scope-local onboarding");
    expect(existsSync(join(codeRoot, "data", "tasks", "archive", `${generatedTaskId}.md`)))
      .toBe(true);
    const scopesAfterFirstWork = await running.client.scopes.list();

    const codeImprovementRun = completedCodeImprovement.runs.find((run) =>
      run.status === "success"
    );
    const observeImprovementRun = completedObserveImprovement.runs.find((run) =>
      run.status === "success"
    );
    expect(codeImprovementRun).toBeDefined();
    expect(observeImprovementRun).toBeDefined();
    expect(existsSync(join(
      codeRoot,
      ".kota",
      "runs",
      codeImprovementRun?.id ?? "missing",
      "scope-improvement.json",
    ))).toBe(true);
    expect(existsSync(join(
      observeRoot,
      ".kota",
      "runs",
      observeImprovementRun?.id ?? "missing",
      "scope-improvement.json",
    ))).toBe(true);

    const pausedForQuality = await running.client.forScope(codeScopeId).workflow
      .pauseAgentForQuality("Acceptance probe for scope-local backoff isolation");
    expect(pausedForQuality).toMatchObject({ ok: true, paused: true });
    const codeBackoff = await running.client.forScope(codeScopeId).workflow.status();
    const observeWithoutBackoff = await running.client.forScope(observeScopeId).workflow.status();
    expect(codeBackoff.agentBackoff).toMatchObject({ kind: "quality" });
    expect(observeWithoutBackoff.agentBackoff).toBeUndefined();
    const pausedObserveForQuality = await running.client.forScope(observeScopeId).workflow
      .pauseAgentForQuality("Acceptance probe for independent sibling backoff");
    expect(pausedObserveForQuality).toMatchObject({ ok: true, paused: true });
    const retriedAgent = await runCli(["workflow", "resume", "--retry-agent"]);
    expect(retriedAgent.exitCode, retriedAgent.stderr).toBe(0);
    expect((await running.client.forScope(codeScopeId).workflow.status()).agentBackoff)
      .toBeUndefined();
    const observeAfterCodeRetry = await running.client.forScope(observeScopeId).workflow
      .status();
    expect(observeAfterCodeRetry.agentBackoff).toMatchObject({ kind: "quality" });
    const retriedObserveAgent = await running.client.forScope(observeScopeId).workflow.resume({
      retryAgent: true,
    });
    expect(retriedObserveAgent.agentBackoffCleared).toBe(true);
    expect((await running.client.forScope(observeScopeId).workflow.status()).agentBackoff)
      .toBeUndefined();

    harnessReady = false;
    const missingSetupScopeId = deriveDirectoryScopeId(missingSetupRoot);
    const missingSetup = await runCli([
      "scope",
      "add",
      missingSetupRoot,
      "--name",
      "Missing provider",
      "--trusted",
      "--improvement",
      "build",
      "--writes",
      "scope-directory",
      "--json",
    ], "y\n");
    expect(missingSetup.exitCode, missingSetup.stderr).toBe(0);
    const missingSetupResult = JSON.parse(missingSetup.stdout);
    expect(missingSetupResult).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: {
          registered: true,
          workflowReady: false,
          blocked: true,
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "builder_harness_unavailable" }),
          ]),
        },
      },
    });
    const missingSetupStatus = await running.client.scopes.getOnboardingStatus(
      missingSetupResult.operation.operationId,
    );
    expect(missingSetupStatus).toMatchObject({
      ok: true,
      operation: {
        readiness: {
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "builder_harness_unavailable" }),
          ]),
        },
      },
    });
    const drainedMissingSetup = await runCli([
      "scope",
      "drain",
      missingSetupScopeId,
      "--json",
    ], "y\n");
    expect(drainedMissingSetup.exitCode, drainedMissingSetup.stderr).toBe(0);
    const removedMissingSetup = await runCli([
      "scope",
      "remove",
      missingSetupScopeId,
      "--json",
    ], "y\n");
    expect(removedMissingSetup.exitCode, removedMissingSetup.stderr).toBe(0);
    harnessReady = true;

    chmodSync(machineDir, 0o500);
    const failedApply = await runCli([
      "scope",
      "add",
      recoveryRoot,
      "--name",
      "Recovery notes",
      "--trusted",
      "--improvement",
      "observe",
      "--writes",
      "none",
      "--json",
    ], "y\n");
    expect(failedApply.exitCode).toBe(1);
    expect(JSON.parse(failedApply.stdout)).toMatchObject({
      ok: false,
      reason: "apply_failed",
      operation: { state: "incomplete", attempts: 1 },
    });
    chmodSync(machineDir, 0o700);
    const recoveryInspection = await running.client.scopes.inspectOnboarding(recoveryRoot);
    expect(recoveryInspection).toMatchObject({ ok: true });
    if (!recoveryInspection.ok) return;
    const recoveryOperationId = recoveryInspection.inspection.operationId;

    await stopDaemon(running);
    running = await startDaemon();
    const restoredScopes = await running.client.scopes.list();
    expect(restoredScopes).toMatchObject({ ok: true });
    if (!restoredScopes.ok) return;
    expect(restoredScopes.scopes.filter((scope) => scope.scopeId === codeScopeId)).toHaveLength(1);
    expect(restoredScopes.scopes.filter((scope) => scope.scopeId === observeScopeId)).toHaveLength(1);
    const restoredCodeOperation = await running.client.scopes.getOnboardingStatus(codeOperationId);
    const restoredObserveOperation = await running.client.scopes.getOnboardingStatus(
      observeOperationId,
    );
    expect(restoredCodeOperation).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: { registered: true, configured: true, trusted: true, workflowReady: true },
      },
    });
    expect(restoredObserveOperation).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: { registered: true, configured: true, trusted: true, workflowReady: true },
      },
    });
    expect(await running.client.scopes.getOnboardingStatus(recoveryOperationId)).toMatchObject({
      ok: true,
      operation: { state: "incomplete", attempts: 1 },
    });

    const restoredCodeStatus = await running.client.forScope(codeScopeId).workflow.status();
    const restoredObserveStatus = await running.client.forScope(observeScopeId).workflow.status();
    const restoredCodeAuthority = await running.client.scopes.inspectAuthority(codeScopeId);
    const restoredObserveAuthority = await running.client.scopes.inspectAuthority(observeScopeId);
    expect(restoredCodeAuthority).toMatchObject({
      ok: true,
      authority: {
        resolvedPolicy: {
          autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
          writes: { mode: "scope-directory" },
        },
      },
    });
    expect(restoredObserveAuthority).toMatchObject({
      ok: true,
      authority: {
        resolvedPolicy: {
          autonomy: { defaultMode: "passive", maxMode: "passive" },
          writes: { mode: "none" },
        },
      },
    });
    expect(restoredCodeStatus.workflows["daily-digest"]?.nextScheduledAt)
      .toEqual(expect.any(String));
    expect(restoredObserveStatus.workflows["daily-digest"]?.nextScheduledAt)
      .toEqual(expect.any(String));
    expect(restoredCodeStatus.agentBackoff).toBeUndefined();
    expect(restoredObserveStatus.agentBackoff).toBeUndefined();

    const retriedRecovery = await runCli([
      "scope",
      "retry",
      recoveryOperationId,
      "--json",
    ], "y\n");
    expect(retriedRecovery.exitCode, retriedRecovery.stderr).toBe(0);
    expect(JSON.parse(retriedRecovery.stdout)).toMatchObject({
      ok: true,
      operation: { state: "succeeded", attempts: 2 },
    });
    expect((await running.client.scopes.list()).ok).toBe(true);
    await waitFor(
      () => running.client.forScope(recoveryScopeId).workflow.listRuns({
        workflow: "scope-improver",
      }),
      (result) => result.runs.some((run) => run.status === "success"),
    );

    const codeImprovementRuns = await running.client.forScope(codeScopeId).workflow.listRuns({
      workflow: "scope-improver",
    });
    const observeImprovementRuns = await running.client.forScope(observeScopeId).workflow.listRuns({
      workflow: "scope-improver",
    });
    expect(codeImprovementRuns.runs.length).toBeGreaterThanOrEqual(1);
    expect(observeImprovementRuns.runs.length).toBeGreaterThanOrEqual(1);
    expect(
      (await running.client.forScope(observeScopeId).ownerQuestions.list({ status: "pending" }))
        .questions,
    ).toHaveLength(1);

    const projectedCode = {
      authority: restoredCodeAuthority,
      workflow: restoredCodeStatus,
      ownerQuestions: await running.client.forScope(codeScopeId).ownerQuestions.list({
        status: "all",
      }),
    };
    const projectedObserve = {
      authority: restoredObserveAuthority,
      workflow: restoredObserveStatus,
      ownerQuestions: await running.client.forScope(observeScopeId).ownerQuestions.list({
        status: "all",
      }),
    };
    const codeHashBeforeRemoval = directoryHash(codeRoot);
    const drainedObserve = await runCli(["scope", "drain", observeScopeId, "--json"], "y\n");
    expect(drainedObserve.exitCode, drainedObserve.stderr).toBe(0);
    expect(JSON.parse(drainedObserve.stdout)).toMatchObject({ ok: true, status: "drained" });
    const observeHashBeforeRemoval = directoryHash(observeRoot);
    const removedObserve = await runCli(["scope", "remove", observeScopeId, "--json"], "y\n");
    expect(removedObserve.exitCode, removedObserve.stderr).toBe(0);
    expect(JSON.parse(removedObserve.stdout)).toMatchObject({ ok: true, status: "removed" });
    const remainingScopes = await running.client.scopes.list();
    expect(remainingScopes).toMatchObject({ ok: true });
    expect(
      remainingScopes.ok &&
        remainingScopes.scopes.some((scope) => scope.scopeId === codeScopeId),
    ).toBe(true);
    expect((await running.client.forScope(codeScopeId).workflow.status()).paused).toBe(false);
    expect(existsSync(observeRoot)).toBe(true);
    expect(directoryHash(observeRoot)).toBe(observeHashBeforeRemoval);
    expect(readFileSync(join(observeRoot, ".kota", "config.json")))
      .toEqual(observeConfigBefore);
    expect(directoryHash(codeRoot)).toBe(codeHashBeforeRemoval);

    const drainedRecovery = await runCli(["scope", "drain", recoveryScopeId, "--json"], "y\n");
    expect(drainedRecovery.exitCode, drainedRecovery.stderr).toBe(0);
    const removedRecovery = await runCli(["scope", "remove", recoveryScopeId, "--json"], "y\n");
    expect(removedRecovery.exitCode, removedRecovery.stderr).toBe(0);

    const scopedRunIds = new Map([
      [
        codeScopeId,
        new Set(
          (await running.client.forScope(codeScopeId).workflow.listRuns({ limit: 100 })).runs
            .map((run) => run.id),
        ),
      ],
      [
        observeScopeId,
        new Set(
          readdirSync(join(observeRoot, ".kota", "runs"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
        ),
      ],
    ]);
    const overlap = [...scopedRunIds.get(codeScopeId)!].filter((id) =>
      scopedRunIds.get(observeScopeId)!.has(id)
    );
    expect(overlap).toEqual([]);
    const scopedEvents = events.filter((event) =>
      typeof (event.payload as { scopeId?: unknown }).scopeId === "string"
    );
    expect(scopedEvents.length).toBeGreaterThan(0);
    const runScopeById = new Map<string, string>();
    for (const [scopeId, runIds] of scopedRunIds) {
      for (const runId of runIds) runScopeById.set(runId, scopeId);
    }
    const correlatedWorkflowEvents = scopedEvents.filter((event) => {
      const runId = (event.payload as { runId?: unknown }).runId;
      return typeof runId === "string" && runScopeById.has(runId);
    });
    expect(correlatedWorkflowEvents.length).toBeGreaterThan(0);
    for (const event of correlatedWorkflowEvents) {
      const payload = event.payload as { runId: string; scopeId: string };
      expect(payload.scopeId).toBe(runScopeById.get(payload.runId));
    }

    const structuralSearch = {
      registryMutationOwners: productionSourceMatches(
        "new ScopeRegistry|registerDirectoryScope\\(",
      ),
      onboardingSurfaceOwners: productionSourceMatches(
        "planOnboarding|addOnboarding|inspectOnboarding",
      ),
      authorityMutationOwners: productionSourceMatches(
        "(authority|scopeAuthority)\\.(apply|applyTransactional)\\(",
      ),
      scopeScaffoldOwners: productionSourceMatches(
        "create-runtime-directory|missingRuntimeDirectories|initializeScopeState",
      ),
      onboardingStateMachineOwners: productionSourceMatches(
        "ScopeOnboardingStore|ScopeOnboardingService",
      ),
      clientActivationOwners: productionSourceMatches(
        "activatePreparedScope\\(|scope\\.onboarding\\.apply",
      ),
    };
    expect(structuralSearch.registryMutationOwners).toEqual([
      "src/core/daemon/daemon-context-factory.ts",
      "src/core/daemon/scope-lifecycle.ts",
      "src/core/daemon/scope-registration.ts",
    ]);
    expect(structuralSearch.onboardingSurfaceOwners.every((path) =>
      path.startsWith("src/core/daemon/") || path.startsWith("src/modules/daemon-ops/")
    )).toBe(true);
    expect(structuralSearch.authorityMutationOwners).toEqual([
      "src/core/daemon/daemon.ts",
      "src/core/daemon/scope-onboarding.ts",
    ]);
    expect(structuralSearch.scopeScaffoldOwners).toEqual([
      "src/core/daemon/scope-onboarding-types.ts",
      "src/core/daemon/scope-onboarding.ts",
      "src/modules/daemon-ops/scope-onboarding-presentation.ts",
    ]);
    expect(structuralSearch.onboardingStateMachineOwners).toEqual([
      "src/core/daemon/daemon-handle.ts",
      "src/core/daemon/daemon-init.ts",
      "src/core/daemon/daemon-runtime-context.ts",
      "src/core/daemon/index.ts",
      "src/core/daemon/scope-onboarding.ts",
    ]);
    expect(structuralSearch.clientActivationOwners).toEqual([
      "src/core/daemon/scope-lifecycle.ts",
      "src/core/daemon/scope-onboarding.ts",
      "src/modules/daemon-ops/operator-ui-scope-surface.ts",
    ]);

    const report = {
      schemaVersion: 1,
      scopes: {
        hostScopeId,
        codeScopeId,
        observeScopeId,
        recoveryScopeId,
        missingSetupScopeId,
      },
      transcript,
      operations: {
        code: await running.client.scopes.getOnboardingStatus(codeOperationId),
        observe: await running.client.scopes.getOnboardingStatus(observeOperationId),
        recovery: await running.client.scopes.getOnboardingStatus(recoveryOperationId),
        missingSetup: missingSetupStatus,
      },
      registrySnapshots: {
        beforeAdd: scopesBeforeAdd,
        afterFirstWork: scopesAfterFirstWork,
        afterRestart: restoredScopes,
        afterRemoval: remainingScopes,
      },
      authority: {
        beforeRestart: { code: codeAuthority, observe: observeAuthority },
        afterRestart: { code: restoredCodeAuthority, observe: restoredObserveAuthority },
      },
      schedules: {
        code: restoredCodeStatus.workflows["daily-digest"]?.nextScheduledAt,
        observe: restoredObserveStatus.workflows["daily-digest"]?.nextScheduledAt,
      },
      runs: {
        code: [...scopedRunIds.get(codeScopeId)!],
        observe: [...scopedRunIds.get(observeScopeId)!],
      },
      hashes: {
        code: { beforeRemoval: codeHashBeforeRemoval, afterRemoval: directoryHash(codeRoot) },
        observe: {
          beforeRemoval: observeHashBeforeRemoval,
          afterRemoval: directoryHash(observeRoot),
        },
      },
      projectedClients: { code: projectedCode, observe: projectedObserve },
      structuralSearch,
      isolation: {
        untrustedSiblingAfterCodeTrust,
        crossScopeFileAbsent: !existsSync(join(observeRoot, "cross-scope-write.txt")),
        activeCodeStatus,
        codeBackoff: codeBackoff.agentBackoff,
        siblingBackoffAfterCodePause: observeWithoutBackoff.agentBackoff ?? null,
        siblingBackoffAfterCodeResume: observeAfterCodeRetry.agentBackoff ?? null,
      },
      eventCounts: Object.fromEntries(
        [hostScopeId, codeScopeId, observeScopeId].map((scopeId) => [
          scopeId,
          scopedEvents.filter((event) =>
            (event.payload as { scopeId: string }).scopeId === scopeId
          ).length,
        ]),
      ),
    };
    const artifactDir = process.env.KOTA_RUN_ARTIFACT_DIR ??
      join(process.cwd(), ".kota", "artifacts", "scope-onboarding-e2e");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "scope-onboarding-e2e.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(
      join(artifactDir, "scope-onboarding-cli-transcript.txt"),
      [
        "# Self-service external scope onboarding CLI transcript",
        "",
        ...transcript.flatMap((entry) => [
          `$ ${entry.command}`,
          `exit: ${entry.exitCode}`,
          "stdout:",
          entry.stdout.trimEnd(),
          "stderr:",
          entry.stderr.trimEnd(),
          "",
        ]),
      ].join("\n"),
    );
    expect(existsSync(join(artifactDir, "scope-onboarding-e2e.json"))).toBe(true);
    expect(existsSync(join(artifactDir, "scope-onboarding-cli-transcript.txt"))).toBe(true);
  }, 240_000);
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupMutationResult,
  ModuleSetupRequirementStatus,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { SetupClient } from "./client.js";
import setupModule from "./index.js";

const SECRET_VALUE = "stdin-secret-token";

function statusFor(requirementId: string): ModuleSetupRequirementStatus {
  return {
    moduleName: "demo",
    requirementId,
    kind: "secret",
    title: "Demo token",
    required: true,
    scope: "project",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://example.com/setup",
      label: "Open setup",
    },
    state: "ready",
    reason: "configured",
    message: "configured",
    secretRefs: [
      {
        name: "DEMO_TOKEN",
        scope: "project",
        present: true,
      },
    ],
  };
}

function mutationFor(requirementId: string): ModuleSetupMutationResult {
  return { ok: true, status: statusFor(requirementId) };
}

function mutationFailure(message: string): ModuleSetupMutationResult {
  return { ok: false, reason: "store_error", message };
}

function startFailure(): ModuleSetupStartResult {
  return {
    ok: false,
    reason: "not_found",
    message: "stub",
  };
}

function setupClient(overrides: Partial<SetupClient>): SetupClient {
  const mutation = mutationFor("api");
  const listResult: ModuleSetupStatusResponse = {
    requirements: [],
    summary: {
      ready: 0,
      missing: 0,
      pending: 0,
      expired: 0,
      revoked: 0,
      unknown: 0,
      unavailable: 0,
    },
  };
  return {
    list: vi.fn(async () => listResult),
    submitForm: vi.fn(async () => mutation),
    storeSecret: vi.fn(async () => mutation),
    start: vi.fn(async () => startFailure()),
    complete: vi.fn(async () => mutation),
    refresh: vi.fn(async () => mutation),
    revoke: vi.fn(async () => mutation),
    ...overrides,
  };
}

function makeProgram(client: SetupClient): Command {
  const program = new Command();
  program.exitOverride();
  const commands = setupModule.commands?.({
    client: { setup: client },
  } as unknown as ModuleContext);
  if (!commands) throw new Error("setup module did not contribute commands");
  for (const command of commands) {
    command.exitOverride();
    for (const subcommand of command.commands) subcommand.exitOverride();
    program.addCommand(command);
  }
  return program;
}

function localSetupClient(ctx: Partial<ModuleContext>): SetupClient {
  const handlers = setupModule.localClient?.(ctx as ModuleContext);
  if (!handlers?.setup) throw new Error("setup module did not contribute a local client");
  return handlers.setup;
}

function mockStdin(text: string): void {
  const mockStdin = {
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(text);
    },
  };
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    mockStdin as unknown as typeof process.stdin,
  );
}

async function captureOutput(
  fn: () => Promise<void>,
): Promise<{ out: string; err: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    outLines.push(`${args.join(" ")}\n`);
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    outLines.push(String(data));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    errLines.push(String(data));
    return true;
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errLines.push(`${args.join(" ")}\n`);
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setup module manifest projection", () => {
  it("resolves setup status inputs through manifest setup links", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-setup-manifest-"));
    try {
      const client = localSetupClient({
        cwd: projectDir,
        getModuleSummaries: () => [
          {
            name: "demo",
            source: "project",
            dependencies: [],
            toolNames: [],
            workflowNames: [],
            channelNames: [],
            skillNames: [],
            agentNames: [],
            agents: [],
            skills: [],
            commandNames: [],
            routeSummaries: [],
            setupRequirements: [
              {
                id: "endpoint",
                kind: "config",
                title: "Endpoint",
                required: true,
                scope: "project",
                sensitivity: "none",
                setup: {
                  mode: "form",
                  fields: [
                    {
                      id: "base-url",
                      label: "Base URL",
                      type: "string",
                      configPath: "modules.demo.baseUrl",
                      required: true,
                    },
                  ],
                },
              },
            ],
            manifest: {
              schemaVersion: 1,
              moduleName: "demo",
              dependencies: [],
              capabilities: [
                {
                  id: "demo.api",
                  description: "Demo API.",
                  scope: "external",
                  scopePolicyHooks: ["setup"],
                  setupRequirementIds: ["endpoint"],
                },
              ],
              dataClasses: [],
              contributions: {
                tools: [],
                workflows: [],
                workflowTriggers: [],
                channels: [],
                skills: [],
                agents: [],
                commands: [],
                routes: [],
                controlRoutes: [],
                events: [],
                eventFlows: [],
                clients: { localNamespaces: [], daemonFactory: false },
                setupRequirements: [
                  {
                    id: "endpoint",
                    kind: "config",
                    setupMode: "form",
                    sensitivity: "none",
                    required: true,
                    healthCapabilityIds: [],
                    statusLinks: {
                      list: "/setup/requirements",
                      refresh: "/setup/requirements/demo/endpoint/refresh",
                      revoke: "/setup/requirements/demo/endpoint",
                      submitForm: "/setup/requirements/demo/endpoint/form",
                    },
                  },
                ],
              },
              effects: [],
              simulation: { support: "full", blockedReasons: [] },
              readiness: {
                setupRequirementIds: ["endpoint"],
                healthCapabilityIds: [],
                healthCheck: "not-declared",
              },
            },
          },
        ],
      });

      const listed = await client.list();
      expect(listed.requirements).toHaveLength(1);
      expect(listed.requirements[0]).toMatchObject({
        moduleName: "demo",
        requirementId: "endpoint",
        state: "missing",
        reason: "config_missing",
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("fails when a manifest setup link has no source declaration", async () => {
    const client = localSetupClient({
      cwd: process.cwd(),
      getModuleSummaries: () => [
        {
          name: "broken",
          source: "project",
          dependencies: [],
          toolNames: [],
          workflowNames: [],
          channelNames: [],
          skillNames: [],
          agentNames: [],
          agents: [],
          skills: [],
          commandNames: [],
          routeSummaries: [],
          setupRequirements: [],
          manifest: {
            schemaVersion: 1,
            moduleName: "broken",
            dependencies: [],
            capabilities: [],
            dataClasses: [],
            contributions: {
              tools: [],
              workflows: [],
              workflowTriggers: [],
              channels: [],
              skills: [],
              agents: [],
              commands: [],
              routes: [],
              controlRoutes: [],
              events: [],
              eventFlows: [],
              clients: { localNamespaces: [], daemonFactory: false },
              setupRequirements: [
                {
                  id: "missing",
                  kind: "secret",
                  setupMode: "url",
                  sensitivity: "secret",
                  required: true,
                  healthCapabilityIds: [],
                  statusLinks: {
                    list: "/setup/requirements",
                    refresh: "/setup/requirements/broken/missing/refresh",
                    revoke: "/setup/requirements/broken/missing",
                    storeSecret: "/setup/requirements/broken/missing/secret",
                    start: "/setup/requirements/broken/missing/start",
                  },
                },
              ],
            },
            effects: [],
            simulation: { support: "full", blockedReasons: [] },
            readiness: {
              setupRequirementIds: ["missing"],
              healthCapabilityIds: [],
              healthCheck: "not-declared",
            },
          },
        },
      ],
    });

    await expect(client.list()).rejects.toThrow(
      /manifest setup requirement "missing" has no setup declaration/,
    );
  });
});

describe("kota setup secret CLI", () => {
  it("reads secret values from stdin without putting them in argv or output", async () => {
    let captured: Record<string, string> | undefined;
    const client = setupClient({
      storeSecret: vi.fn(async (_moduleName, _requirementId, secretValues) => {
        captured = secretValues;
        return mutationFor("api");
      }),
    });
    const argv = [
      "node",
      "kota",
      "setup",
      "secret",
      "demo",
      "api",
      "--secret-values-stdin",
    ];
    mockStdin(JSON.stringify({ DEMO_TOKEN: SECRET_VALUE }));

    const { out, err } = await captureOutput(async () => {
      await makeProgram(client).parseAsync(argv);
    });

    expect(captured).toEqual({ DEMO_TOKEN: SECRET_VALUE });
    expect(argv.join(" ")).not.toContain(SECRET_VALUE);
    expect(out).toContain("demo/api: ready");
    expect(out).not.toContain(SECRET_VALUE);
    expect(err).not.toContain(SECRET_VALUE);
  });

  it("redacts submitted stdin secrets from JSON results", async () => {
    const complexSecret = "stdin-secret-with-\"quote\\slash\nnewline";
    const jsonEscapedSecret = JSON.stringify(complexSecret).slice(1, -1);
    const client = setupClient({
      storeSecret: vi.fn(async () =>
        mutationFailure(`downstream accidentally included ${complexSecret}`),
      ),
    });
    mockStdin(JSON.stringify({ DEMO_TOKEN: complexSecret }));

    const { out } = await captureOutput(async () => {
      await makeProgram(client).parseAsync([
        "node",
        "kota",
        "setup",
        "secret",
        "demo",
        "api",
        "--secret-values-stdin",
        "--json",
      ]);
    });

    expect(out).toContain("<redacted>");
    expect(out).not.toContain(complexSecret);
    expect(out).not.toContain(jsonEscapedSecret);
  });

  it("does not expose the removed raw argv option in help", () => {
    const setupCommand = makeProgram(setupClient({})).commands.find(
      (command) => command.name() === "setup",
    );
    const secretCommand = setupCommand?.commands.find(
      (command) => command.name() === "secret",
    );

    expect(secretCommand?.helpInformation()).toContain("--secret-values-stdin");
    expect(secretCommand?.helpInformation()).not.toContain("--secret-values <json>");
  });

  it("rejects the removed raw argv option without forwarding the secret", async () => {
    const storeSecret = vi.fn(async () => mutationFor("api"));
    const client = setupClient({ storeSecret });

    await expect(
      captureOutput(async () => {
        await makeProgram(client).parseAsync([
          "node",
          "kota",
          "setup",
          "secret",
          "demo",
          "api",
          "--secret-values",
          JSON.stringify({ DEMO_TOKEN: SECRET_VALUE }),
        ]);
      }),
    ).rejects.toThrow(/unknown option '--secret-values'/);

    expect(storeSecret).not.toHaveBeenCalled();
  });
});

describe("kota setup complete CLI", () => {
  it("reads completion secret values from stdin while preserving non-sensitive argv values", async () => {
    let captured: ModuleSetupCompleteInput | undefined;
    const client = setupClient({
      complete: vi.fn(async (_actionId, input) => {
        captured = input;
        return mutationFor("oauth");
      }),
    });
    const argv = [
      "node",
      "kota",
      "setup",
      "complete",
      "demo.oauth.1",
      "--config-values",
      JSON.stringify({ region: "eu" }),
      "--secret-values-stdin",
    ];
    mockStdin(JSON.stringify({ DEMO_TOKEN: SECRET_VALUE }));

    const { out, err } = await captureOutput(async () => {
      await makeProgram(client).parseAsync(argv);
    });

    expect(captured).toEqual({
      configValues: { region: "eu" },
      secretValues: { DEMO_TOKEN: SECRET_VALUE },
    });
    expect(argv.join(" ")).not.toContain(SECRET_VALUE);
    expect(out).toContain("demo/oauth: ready");
    expect(out).not.toContain(SECRET_VALUE);
    expect(err).not.toContain(SECRET_VALUE);
  });

  it("does not expose the removed completion raw argv option in help", () => {
    const setupCommand = makeProgram(setupClient({})).commands.find(
      (command) => command.name() === "setup",
    );
    const completeCommand = setupCommand?.commands.find(
      (command) => command.name() === "complete",
    );

    expect(completeCommand?.helpInformation()).toContain("--secret-values-stdin");
    expect(completeCommand?.helpInformation()).not.toContain("--secret-values <json>");
  });
});

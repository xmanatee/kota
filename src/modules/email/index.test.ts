import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import emailModule from "./index.js";
import { createMailer } from "./mailer.js";

vi.mock("./mailer.js", () => ({
  createMailer: vi.fn(() => ({
    send: vi.fn(),
    verify: vi.fn(),
    close: vi.fn(),
  })),
}));

function makeCtx(config: Record<string, unknown>): ModuleContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: {} as ModuleContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn(() => []),
    getContributedWorkflows: vi.fn(() => []),
    getContributedChannels: vi.fn(() => []),
    getModuleConfig: vi.fn(() => config),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getSecret: vi.fn(() => null),
    listTools: vi.fn(() => []),
    events: {
      emit: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      emitExternal: vi.fn(),
      subscribeExternal: vi.fn(() => () => {}),
      listenerCount: vi.fn(() => 0),
    },
    createSession: vi.fn(),
    registerProvider: vi.fn(),
    getProvider: vi.fn(() => null),
    callTool: vi.fn(),
    registerMiddleware: vi.fn(),
    getModuleSummaries: vi.fn(() => []),
  } as unknown as ModuleContext;
}

afterEach(() => {
  emailModule.onUnload?.();
  vi.clearAllMocks();
});

describe("email module setup", () => {
  it("declares setup requirements for SMTP routing and optional credentials", () => {
    const setupRequirements = emailModule.setupRequirements;
    if (!setupRequirements || typeof setupRequirements === "function") {
      throw new Error("expected static setup requirements");
    }
    const configRequirement = setupRequirements.find(
      (requirement) => requirement.id === "smtp-config",
    );
    if (!configRequirement || configRequirement.kind !== "config") {
      throw new Error("expected smtp-config setup requirement");
    }
    expect(configRequirement.setup.fields.map((field) => ({
      id: field.id,
      valueKind: field.valueKind,
      configPath: field.configPath,
      required: field.required,
    }))).toEqual([
      {
        id: "smtp-host",
        valueKind: undefined,
        configPath: "modules.email.smtp.host",
        required: true,
      },
      {
        id: "from",
        valueKind: undefined,
        configPath: "modules.email.from",
        required: true,
      },
      {
        id: "to",
        valueKind: undefined,
        configPath: "modules.email.to",
        required: true,
      },
      {
        id: "smtp-port",
        valueKind: undefined,
        configPath: "modules.email.smtp.port",
        required: false,
      },
      {
        id: "smtp-secure",
        valueKind: undefined,
        configPath: "modules.email.smtp.secure",
        required: false,
      },
      {
        id: "smtp-user-ref",
        valueKind: "secret-reference",
        configPath: "modules.email.smtp.auth.user",
        required: false,
      },
      {
        id: "smtp-pass-ref",
        valueKind: "secret-reference",
        configPath: "modules.email.smtp.auth.pass",
        required: false,
      },
    ]);

    const secretRequirement = setupRequirements.find(
      (requirement) => requirement.id === "smtp-credentials",
    );
    if (!secretRequirement || secretRequirement.kind !== "secret") {
      throw new Error("expected smtp-credentials setup requirement");
    }
    expect(secretRequirement.secretRefs).toEqual([
      { name: "SMTP_USER", scope: "project" },
      { name: "SMTP_PASS", scope: "project" },
    ]);
  });

  it("resolves SMTP auth secret references before creating the mailer", () => {
    const ctx = makeCtx({
      smtp: {
        host: "smtp.example.test",
        auth: {
          user: "$SMTP_USER",
          pass: "$SMTP_PASS",
        },
      },
      from: "kota@example.test",
      to: "operator@example.test",
    });
    vi.mocked(ctx.getSecret).mockImplementation(
      (key) => ({
        SMTP_USER: "stored-user",
        SMTP_PASS: "stored-pass",
      })[key] ?? null,
    );

    emailModule.onLoad?.(ctx as never);

    expect(createMailer).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        auth: {
          user: "stored-user",
          pass: "stored-pass",
        },
      }),
    );
  });
});

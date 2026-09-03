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
    cwd: "/tmp",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: {} as ModuleContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn(() => []),
    getContributedWorkflows: vi.fn(() => []),
    getContributedChannels: vi.fn(() => []),
      getContributedUiSurfaces: () => [],
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
  vi.clearAllMocks();
});

describe("email module setup", () => {
  it("resolves SMTP auth secret references before creating the mailer", async () => {
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

    const activation = await emailModule.onLoad?.(ctx as never);

    expect(createMailer).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        auth: {
          user: "stored-user",
          pass: "stored-pass",
        },
      }),
    );
    await activation?.dispose();
  });
});

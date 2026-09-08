import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getScopeSecretStore } from "#core/config/secrets.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import emailModule from "./index.js";
import { createMailer } from "./mailer.js";

vi.mock("./mailer.js", () => ({
  createMailer: vi.fn(() => ({
    send: vi.fn(),
    verify: vi.fn(),
    close: vi.fn(),
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("email module setup", () => {

  it("resolves SMTP auth secret references before creating the mailer", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "email-channel-"));
    const loader = new ModuleLoader({ modules: { email: {
      smtp: {
        host: "smtp.example.test",
        auth: {
          user: "$SMTP_USER",
          pass: "$SMTP_PASS",
        },
      },
      from: "kota@example.test",
      to: "operator@example.test",
    } } });
    loader.setCwd(scopeRoot);
    loader.setBus(new EventBus());
    const secrets = getScopeSecretStore(scopeRoot);
    secrets.set("SMTP_USER", "stored-user");
    secrets.set("SMTP_PASS", "stored-pass");
    try {
    await loader.load(emailModule);

    expect(createMailer).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        auth: {
          user: "stored-user",
          pass: "stored-pass",
        },
      }),
    );
    } finally {
      await loader.unloadAll();
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});

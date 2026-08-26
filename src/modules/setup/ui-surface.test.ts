import { describe, expect, it } from "vitest";
import { projectModuleSetupStatusForClient } from "#core/modules/setup-requirements.js";
import { renderUiSurface } from "#modules/daemon-ops/operator-ui.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { ModuleSetupStatusResponse } from "./client.js";
import { buildSetupUiSurface } from "./ui-surface.js";

function setupStatus(): ModuleSetupStatusResponse {
  return {
    visibility: "full",
    requirements: [
      {
        moduleName: "telegram",
        requirementId: "bot-credentials",
        kind: "secret",
        title: "Telegram bot credentials",
        required: true,
        scope: "project",
        sensitivity: "secret",
        setup: { mode: "url", url: "https://t.me/BotFather", label: "Open BotFather" },
        state: "missing",
        reason: "secret_missing",
        message: "Required credential is missing",
        secretRefs: [{ name: "TELEGRAM_BOT_TOKEN", scope: "project", present: false }],
      },
      {
        moduleName: "google-workspace",
        requirementId: "oauth-config",
        kind: "config",
        title: "Google Workspace OAuth config references",
        required: true,
        scope: "project",
        sensitivity: "none",
        setup: {
          mode: "form",
          fields: [{
            id: "client-id-ref",
            label: "Client ID reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.google-workspace.clientId",
            required: true,
          }],
        },
        state: "ready",
        reason: "config_present",
        message: "Required configuration is present",
      },
      {
        moduleName: "google-workspace",
        requirementId: "oauth-credentials",
        kind: "oauth",
        title: "Google Workspace OAuth credentials",
        required: true,
        scope: "project",
        sensitivity: "oauth",
        setup: {
          mode: "url",
          url: "https://console.cloud.google.com/apis/credentials",
          label: "Open Google Cloud OAuth credentials",
        },
        state: "pending",
        reason: "url_setup_pending",
        message: "Setup URL action is pending",
        secretRefs: [{ name: "GOOGLE_REFRESH_TOKEN", scope: "project", present: false }],
        pendingAction: {
          actionId: "google-workspace.oauth-credentials.1770000000000",
          moduleName: "google-workspace",
          requirementId: "oauth-credentials",
          url: "https://console.cloud.google.com/apis/credentials",
          label: "Open Google Cloud OAuth credentials",
          status: "pending",
          createdAt: "2026-06-04T08:00:00.000Z",
          expiresAt: "2026-06-04T08:30:00.000Z",
        },
      },
      {
        moduleName: "browser",
        requirementId: "auth-profile",
        kind: "browser-profile",
        title: "Authenticated browser profile",
        required: false,
        scope: "project",
        sensitivity: "browser-profile",
        setup: {
          mode: "form",
          fields: [{
            id: "storage-state-path",
            label: "Storage state path",
            type: "string",
            configPath: "modules.browser.storageStatePath",
            required: true,
          }],
        },
        state: "unavailable",
        reason: "browser_profile_file_missing",
        message: "Browser profile file does not exist",
      },
    ],
    summary: {
      ready: 1,
      missing: 1,
      pending: 1,
      expired: 0,
      revoked: 0,
      unknown: 0,
      unavailable: 1,
    },
  };
}

describe("setup UI surface", () => {
  it("builds form, secret, URL, refresh, and revoke actions", () => {
    const surface = buildSetupUiSurface({
      scopeId: "p-kota-fixture-default",
      setup: { ok: true, value: setupStatus() },
    });
    expect(surface.surfaceId).toBe("setup");
    expect(surface.intent).toBe("Setup");
    expect(surface.nodes.map((node) => node.kind)).toEqual([
      "status-summary",
      "table",
      "form",
      "form",
      "form",
      "form",
      "form",
      "action-list",
    ]);

    const config = surface.actions.find((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-config.submit-form"
    );
    expect(config?.operation).toEqual({
      kind: "daemon-route",
      method: "POST",
      path: "/setup/requirements/google-workspace/oauth-config/form",
    });
    expect(config?.parameters?.fields.map((field) => field.id)).toEqual(["client-id-ref"]);
    expect(config?.parameters?.schema.properties["client-id-ref"]).toMatchObject({
      type: "string",
      format: "secret-reference",
    });

    const secret = surface.actions.find((candidate) =>
      candidate.actionId === "setup.telegram.bot-credentials.store-secret"
    );
    expect(secret?.parameters?.fields).toEqual([
      expect.objectContaining({ id: "TELEGRAM_BOT_TOKEN", input: "secret", required: true }),
    ]);
    expect(secret?.readiness).toMatchObject({
      state: "needs-setup",
      moduleName: "telegram",
      requirementId: "bot-credentials",
    });
    expect(secret?.conditions).toEqual([{
      kind: "setup",
      moduleName: "telegram",
      requirementId: "bot-credentials",
      state: "missing",
    }]);
    const complete = surface.actions.find((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-credentials.complete"
    );
    expect(complete?.effect).toBe("write");
    expect(complete?.operation).toEqual({
      kind: "daemon-route",
      method: "POST",
      path: "/setup/actions/google-workspace.oauth-credentials.1770000000000/complete",
    });
    expect(complete?.parameters?.fields).toEqual([
      expect.objectContaining({
        id: "GOOGLE_REFRESH_TOKEN",
        input: "secret",
        required: true,
      }),
    ]);
    expect(complete?.readiness.state).toBe("ready");
    expect(surface.actions.some((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-credentials.start"
    )).toBe(false);
    const revoke = surface.actions.find((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-credentials.revoke"
    );
    expect(revoke?.confirmation).toMatchObject({ mode: "required", risk: "medium" });

    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("Setup and auth requirements");
    expect(rendered).toContain("TELEGRAM_BOT_TOKEN");
    expect(rendered).not.toContain("stdin-secret-token");

    const expiredStatus = setupStatus();
    const oauth = expiredStatus.requirements.find((requirement) =>
      requirement.requirementId === "oauth-credentials"
    )!;
    oauth.state = "expired";
    oauth.reason = "url_setup_expired";
    oauth.message = "Setup URL action expired";
    const expiredSurface = buildSetupUiSurface({
      scopeId: "p-kota-fixture-default",
      setup: { ok: true, value: expiredStatus },
    });
    expect(expiredSurface.actions.some((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-credentials.start"
    )).toBe(true);
    expect(expiredSurface.actions.some((candidate) =>
      candidate.actionId === "setup.google-workspace.oauth-credentials.complete"
    )).toBe(false);
  });

  it("builds executable actions from preserved credential identifiers", () => {
    const base = setupStatus();
    const projected: ModuleSetupStatusResponse = {
      visibility: "full",
      requirements: [projectModuleSetupStatusForClient({
        ...base.requirements[0]!,
        moduleName: "model-clients",
        requirementId: "openrouter-api-key",
        title: "OpenRouter API key credential",
        message: "API key credential is missing; token=sk-adversarial-value-1234567890",
        secretRefs: [{ name: "OPENROUTER_API_KEY", scope: "global", present: false }],
      }, "web-client")],
      summary: {
        ready: 0,
        missing: 1,
        pending: 0,
        expired: 0,
        revoked: 0,
        unknown: 0,
        unavailable: 0,
      },
    };
    const surface = buildSetupUiSurface({
      scopeId: "p-kota-fixture-default",
      setup: { ok: true, value: projected },
    });
    const storeSecret = surface.actions.find((candidate) =>
      candidate.actionId === "setup.model-clients.openrouter-api-key.store-secret"
    );
    expect(storeSecret?.operation).toEqual({
      kind: "daemon-route",
      method: "POST",
      path: "/setup/requirements/model-clients/openrouter-api-key/secret",
    });
    expect(storeSecret?.parameters?.fields).toEqual([
      expect.objectContaining({ id: "OPENROUTER_API_KEY", input: "secret" }),
    ]);
    const table = surface.nodes.find((node) => node.kind === "table");
    expect(table?.kind === "table" ? table.rows[0]?.cells : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columnId: "detail",
          value: expect.stringContaining("token=[redacted]"),
        }),
      ]),
    );

    const rendered = renderToString(renderUiSurface(surface), { width: 240 });
    expect(rendered).toContain("model-clients/openrouter-api-key");
    expect(rendered).not.toContain("sk-adversarial-value-1234567890");
  });

});

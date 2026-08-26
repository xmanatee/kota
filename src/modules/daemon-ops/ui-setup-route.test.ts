import { describe, expect, it, vi } from "vitest";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
  executeLocalSetupRoute,
  setupRouteBody,
} from "./ui-setup-route.js";

describe("setup UI completion routes", () => {
  it("wraps flat secret fields in the daemon completion body", () => {
    expect(setupRouteBody(
      {
        kind: "daemon-route",
        method: "POST",
        path: "/setup/actions/telegram.bot-credentials.1770000000000/complete",
      },
      { TELEGRAM_BOT_TOKEN: "submitted-secret" },
    )).toEqual({
      secretValues: { TELEGRAM_BOT_TOKEN: "submitted-secret" },
    });
  });

  it("passes completion secrets through the local setup client", async () => {
    const complete = vi.fn(async () => ({
      ok: true as const,
      status: {
        moduleName: "telegram",
        requirementId: "bot-credentials",
        state: "ready" as const,
      },
    }));
    const client = {
      setup: { complete },
    } as unknown as KotaClient;

    const result = await executeLocalSetupRoute(
      client,
      {
        kind: "daemon-route",
        method: "POST",
        path: "/setup/actions/telegram.bot-credentials.1770000000000/complete",
      },
      { TELEGRAM_BOT_TOKEN: "submitted-secret" },
    );

    expect(complete).toHaveBeenCalledWith(
      "telegram.bot-credentials.1770000000000",
      { secretValues: { TELEGRAM_BOT_TOKEN: "submitted-secret" } },
    );
    expect(result).toEqual({ ok: true, message: "Setup action completed." });
  });
});

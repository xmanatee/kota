import { describe, expect, it } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import historyModule from "#modules/history/index.js";
import {
  ContractDecodeError,
  DAEMON_ROUTES,
} from "#root/client/daemon-contract.generated.js";

describe("data adapter daemon composition", () => {
  it("runs generated search decoding beside the authored history not-found transform", async () => {
    let malformedSearch = false;
    let searchRequest: { method: string; path: string } | undefined;
    const transport = {
      requestStrict: async (method: string, path: string) => {
        searchRequest = { method, path };
        return malformedSearch
          ? { ok: false, reason: "future_reason" }
          : { ok: true, conversations: [] };
      },
      fetchRaw: async () => new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    } as unknown as DaemonTransport;
    const client = historyModule.daemonClient!(transport).history!;

    await expect(client.search("missing", { semantic: true })).resolves.toEqual({
      ok: true,
      conversations: [],
    });
    expect(searchRequest).toEqual({
      method: DAEMON_ROUTES.historySearch.method,
      path: `${DAEMON_ROUTES.historySearch.path}?q=missing&semantic=true`,
    });
    await expect(client.show("missing")).resolves.toEqual({ found: false });

    malformedSearch = true;
    await expect(client.search("malformed")).rejects.toBeInstanceOf(
      ContractDecodeError,
    );
  });
});

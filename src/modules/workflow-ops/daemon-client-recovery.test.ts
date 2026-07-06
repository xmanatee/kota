import { describe, expect, it } from "vitest";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import workflowOpsModule from "./index.js";

function makeTransport(response: unknown): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async <T>(
      _method: string,
      _path: string,
      _body?: unknown,
      _init?: DaemonRequestInit,
    ): Promise<T | null> => response as T,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty
    },
  };
}

describe("workflow-ops daemonClient recovery responses", () => {
  it("resume preserves dirty-recovery blocked responses from the daemon", async () => {
    const wf = workflowOpsModule.daemonClient!(
      makeTransport({
        paused: true,
        already: true,
        blocked: "dirty-recovery",
        message: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
      }),
    ).workflow!;

    await expect(wf.resume()).resolves.toEqual({
      paused: true,
      already: true,
      blocked: "dirty-recovery",
      message: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
    });
  });
});

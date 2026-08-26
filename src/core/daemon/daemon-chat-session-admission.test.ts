import { describe, expect, it } from "vitest";
import { handleCreateDaemonSession } from "./daemon-chat-session-create.js";
import {
  makeBindingStore,
  makePool,
  makeResolver,
  mockAgentSession,
  mockRequest,
  mockResponse,
  SCOPE_ID,
} from "./daemon-chat-test-support.integration.js";

describe("daemon chat session scope admission", () => {
  it("rechecks scope admission after the request body before creating state", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const req = mockRequest();
    const res = mockResponse();
    let state: "hosted" | "draining" = "hosted";
    const creating = handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      SCOPE_ID,
      makeResolver(),
      () => state === "hosted"
        ? { ok: true }
        : {
            ok: false,
            reason: "scope_not_hosted",
            scopeId: SCOPE_ID,
            state,
          },
    );

    state = "draining";
    req.emit("end");
    await creating;

    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(JSON.parse(res._written.at(-1) ?? "")).toEqual({
      error: `Scope ${SCOPE_ID} is draining and cannot accept sessions`,
      reason: "scope_not_hosted",
      scopeId: SCOPE_ID,
      state: "draining",
    });
    expect(pool.size).toBe(0);
    expect(bindings.list()).toEqual([]);
  });
});

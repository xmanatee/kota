import { describe, expect, it, vi } from "vitest";
import type { ModuleRouteHandler, RouteRegistration } from "#core/modules/module-types.js";

/** Wire contract for production hosts using the shared route error boundary. */
export function routeInvocationContract(
  start: (routes: RouteRegistration[]) => Promise<string>,
  token: string,
): void {
  it("delivers matched parameters to protocol-shaped auth denials without invoking privileged work", async () => {
    const privileged = vi.fn<ModuleRouteHandler>();
    const baseUrl = await start([{
      method: "POST", path: "/api/invocation/:id", handler: privileged,
      authFailureHandler: (_req, res, params) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "CUSTOM_AUTH", id: params.id } }));
      },
    }]);
    const response = await fetch(`${baseUrl}/api/invocation/example`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ error: { code: "CUSTOM_AUTH", id: "example" } });
    expect(privileged).not.toHaveBeenCalled();
  });

  it("leaves request authentication to routes that explicitly bypass host auth", async () => {
    const denial = vi.fn<ModuleRouteHandler>();
    const baseUrl = await start([{
      method: "POST", path: "/api/invocation/:id", bypassAuth: true,
      authFailureHandler: denial,
      handler: (_req, res, params) => {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Module requires a signature", id: params.id }));
      },
    }]);
    const response = await fetch(`${baseUrl}/api/invocation/example`, {
      method: "POST", headers: { Authorization: "Bearer invalid" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Module requires a signature", id: "example" });
    expect(denial).not.toHaveBeenCalled();
  });

  describe.each(["handler", "authFailureHandler"] as const)("%s failures", (entry) => {
    describe.each(["throw", "reject"] as const)("%s", (failure) => {
      it.each(["unsent", "streaming", "ended"] as const)("preserves a %s response", async (state) => {
        const fail: ModuleRouteHandler = (_req, res) => {
          if (state !== "unsent") {
            res.writeHead(202, { "Content-Type": "text/plain" });
            if (state === "ended") res.end("accepted");
            else {
              res.write("accepted");
              setImmediate(() => res.end());
            }
          }
          if (failure === "throw") throw new Error("route failed");
          return Promise.reject("route failed");
        };
        const privileged = vi.fn<ModuleRouteHandler>();
        const baseUrl = await start([{
          method: "GET",
          path: "/api/invocation/:id",
          handler: privileged,
          [entry]: fail,
        }]);
        const response = await fetch(`${baseUrl}/api/invocation/example`, {
          headers: entry === "handler" ? { Authorization: `Bearer ${token}` } : {},
        });
        expect(response.status).toBe(state === "unsent" ? 500 : 202);
        expect(await response.text()).toBe(state === "unsent"
          ? JSON.stringify({ error: "route failed" })
          : "accepted");
        expect(privileged).not.toHaveBeenCalled();
      });
    });
  });
}

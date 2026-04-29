import { describe, expect, it } from "vitest";
import { findKeyedRouteMatch, findRouteMatch, matchRoutePath } from "./route-matcher.js";

describe("matchRoutePath", () => {
  it("matches exact literal paths", () => {
    expect(matchRoutePath("/status", "/status")).toEqual({});
    expect(matchRoutePath("/status", "/other")).toBeNull();
  });

  it("captures :name segments", () => {
    expect(matchRoutePath("/api/tasks/:id/state", "/api/tasks/abc/state")).toEqual({ id: "abc" });
    expect(matchRoutePath("/api/tasks/:id/state", "/api/tasks/abc/body")).toBeNull();
    expect(matchRoutePath("/api/tasks/:id/state", "/api/tasks//state")).toEqual({ id: "" });
  });

  it("rejects paths with mismatched lengths", () => {
    expect(matchRoutePath("/api/tasks/:id", "/api/tasks")).toBeNull();
    expect(matchRoutePath("/api/tasks/:id", "/api/tasks/a/b")).toBeNull();
  });

  it("decodes :name segment values", () => {
    expect(matchRoutePath("/api/tasks/:id", "/api/tasks/foo%20bar")).toEqual({ id: "foo bar" });
  });

  it("captures *name as trailing rest including slashes", () => {
    expect(matchRoutePath("/assets/*rest", "/assets/foo.js")).toEqual({ rest: "foo.js" });
    expect(matchRoutePath("/assets/*rest", "/assets/foo/bar.js")).toEqual({ rest: "foo/bar.js" });
    expect(matchRoutePath("/assets/*rest", "/assets/")).toEqual({ rest: "" });
  });

  it("rejects non-trailing wildcard patterns", () => {
    expect(matchRoutePath("/assets/*rest/x", "/assets/a/x")).toBeNull();
  });
});

describe("findRouteMatch", () => {
  const routes = [
    { method: "GET", path: "/api/tasks/normalized", tag: "normalized" },
    { method: "GET", path: "/api/tasks/:id", tag: "show" },
    { method: "POST", path: "/api/tasks/:id/state", tag: "state" },
    { method: "GET", path: "/assets/*rest", tag: "asset" },
  ];

  it("prefers exact match over :name patterns", () => {
    const m = findRouteMatch(routes, "GET", "/api/tasks/normalized");
    expect(m?.route.tag).toBe("normalized");
    expect(m?.params).toEqual({});
  });

  it("falls back to :name match when no exact route matches", () => {
    const m = findRouteMatch(routes, "GET", "/api/tasks/abc");
    expect(m?.route.tag).toBe("show");
    expect(m?.params).toEqual({ id: "abc" });
  });

  it("matches POST :name routes", () => {
    const m = findRouteMatch(routes, "POST", "/api/tasks/abc/state");
    expect(m?.route.tag).toBe("state");
    expect(m?.params).toEqual({ id: "abc" });
  });

  it("matches *name catch-all", () => {
    const m = findRouteMatch(routes, "GET", "/assets/foo/bar.js");
    expect(m?.route.tag).toBe("asset");
    expect(m?.params).toEqual({ rest: "foo/bar.js" });
  });

  it("returns null when no route matches", () => {
    expect(findRouteMatch(routes, "GET", "/unknown")).toBeNull();
    expect(findRouteMatch(routes, "DELETE", "/api/tasks/normalized")).toBeNull();
  });
});

describe("findKeyedRouteMatch", () => {
  const keys = new Set([
    "GET /status",
    "GET /workflow/runs",
    "GET /workflow/runs/:id",
    "POST /workflow/runs/:id/abort",
    "POST /sessions",
    "POST /sessions/register",
    "POST /sessions/:id/chat",
  ]);

  it("matches exact keys first", () => {
    expect(findKeyedRouteMatch(keys, "POST", "/sessions/register")).toEqual({
      key: "POST /sessions/register",
      params: {},
    });
  });

  it("matches :name keys when no exact key matches", () => {
    expect(findKeyedRouteMatch(keys, "GET", "/workflow/runs/r123")).toEqual({
      key: "GET /workflow/runs/:id",
      params: { id: "r123" },
    });
    expect(findKeyedRouteMatch(keys, "POST", "/sessions/abc/chat")).toEqual({
      key: "POST /sessions/:id/chat",
      params: { id: "abc" },
    });
  });

  it("returns null when no key matches", () => {
    expect(findKeyedRouteMatch(keys, "DELETE", "/status")).toBeNull();
    expect(findKeyedRouteMatch(keys, "GET", "/unknown")).toBeNull();
  });
});

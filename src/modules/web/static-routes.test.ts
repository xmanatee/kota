import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchRoutePath } from "#core/modules/route-matcher.js";
import { staticWebUiRoutes } from "./static-routes.js";

type Captured = {
  res: ServerResponse;
  status?: number;
  headers?: Record<string, string | number>;
  body: Buffer;
};

function mockRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function mockResponse(): Captured {
  const captured = { body: Buffer.alloc(0) } as Captured;
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number, headers?: Record<string, string | number>) => {
      captured.status = status;
      captured.headers = headers;
      return res;
    },
    end: vi.fn((body?: Buffer | string) => {
      if (Buffer.isBuffer(body)) captured.body = body;
      else if (typeof body === "string") captured.body = Buffer.from(body);
    }),
  } as unknown as ServerResponse;
  captured.res = res;
  return captured;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kota-web-static-"));
  mkdirSync(join(tmpDir, "assets"));
  writeFileSync(join(tmpDir, "index.html"), "<html><body>kota</body></html>");
  writeFileSync(join(tmpDir, "assets", "app.js"), "console.log('app');");
  writeFileSync(join(tmpDir, "assets", "app.css"), "body{color:red}");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("staticWebUiRoutes", () => {
  it("registers GET /, GET /index.html, and a /assets/*rest pattern route", () => {
    const routes = staticWebUiRoutes();
    const summaries = routes.map((r) => `${r.method} ${r.path}`);
    expect(summaries).toEqual(["GET /", "GET /index.html", "GET /assets/*rest"]);
    const assetsRoute = routes[2];
    expect(matchRoutePath(assetsRoute.path, "/assets/app.js")).toEqual({ rest: "app.js" });
    expect(matchRoutePath(assetsRoute.path, "/assets/")).toEqual({ rest: "" });
    expect(matchRoutePath(assetsRoute.path, "/api/health")).toBeNull();
  });

  it("does not request bypassAuth (static UI lives outside /api/)", () => {
    for (const route of staticWebUiRoutes()) {
      expect(route.bypassAuth).toBeUndefined();
    }
  });

  it("serves a built dashboard from projectDir without serve-time global setup", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-web-project-"));
    const distDir = join(projectDir, "clients", "web", "dist");
    try {
      mkdirSync(join(distDir, "assets"), { recursive: true });
      writeFileSync(join(distDir, "index.html"), "<html><body>daemon dashboard</body></html>");

      const routes = staticWebUiRoutes({ projectDir });
      const captured = mockResponse();
      routes[0].handler(mockRequest("/"), captured.res, {});

      expect(captured.status).toBe(200);
      expect(captured.headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(captured.body.toString()).toContain("daemon dashboard");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves index.html with text/html content-type from a webUiDir option", () => {
    const routes = staticWebUiRoutes({ webUiDir: tmpDir });
    const captured = mockResponse();
    routes[0].handler(mockRequest("/"), captured.res, {});
    expect(captured.status).toBe(200);
    expect(captured.headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(captured.headers?.["Cache-Control"]).toBeUndefined();
    expect(captured.body.toString()).toContain("<html>");
  });

  it("treats /index.html identically to /", () => {
    const routes = staticWebUiRoutes({ webUiDir: tmpDir });
    const captured = mockResponse();
    routes[1].handler(mockRequest("/index.html"), captured.res, {});
    expect(captured.status).toBe(200);
    expect(captured.headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
  });

  it("serves /assets/* with immutable cache and inferred content-type", () => {
    const routes = staticWebUiRoutes({ webUiDir: tmpDir });
    const assetsRoute = routes[2];

    const js = mockResponse();
    assetsRoute.handler(mockRequest("/assets/app.js"), js.res, { rest: "app.js" });
    expect(js.status).toBe(200);
    expect(js.headers?.["Content-Type"]).toBe("application/javascript");
    expect(js.headers?.["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(js.body.toString()).toContain("console.log");

    const css = mockResponse();
    assetsRoute.handler(mockRequest("/assets/app.css"), css.res, { rest: "app.css" });
    expect(css.status).toBe(200);
    expect(css.headers?.["Content-Type"]).toBe("text/css");
  });

  it("falls back to application/octet-stream for unknown extensions", () => {
    writeFileSync(join(tmpDir, "assets", "data.bin"), "binary-payload");
    const captured = mockResponse();
    staticWebUiRoutes({ webUiDir: tmpDir })[2].handler(
      mockRequest("/assets/data.bin"),
      captured.res,
      { rest: "data.bin" },
    );
    expect(captured.status).toBe(200);
    expect(captured.headers?.["Content-Type"]).toBe("application/octet-stream");
  });

  it("rejects /assets/* requests that traverse out of the assets prefix", () => {
    // URL normalization collapses `/assets/../etc` to `/etc`, which the
    // asset route's path pattern then refuses to match.
    const assetsRoute = staticWebUiRoutes()[2];
    expect(matchRoutePath(
      assetsRoute.path,
      new URL("/assets/../etc/passwd", "http://localhost").pathname,
    )).toBeNull();
  });

  it("does not decode encoded separators into traversal", () => {
    const captured = mockResponse();
    staticWebUiRoutes({ webUiDir: tmpDir })[2].handler(
      { url: "/assets/..%2Fsecret" } as IncomingMessage,
      captured.res,
      { rest: "..%2Fsecret" },
    );
    expect(captured.status).toBe(404);
  });

  it("returns JSON 404 'Web UI not installed' for / when no UI directory is configured", () => {
    const captured = mockResponse();
    staticWebUiRoutes()[0].handler(mockRequest("/"), captured.res, {});
    expect(captured.status).toBe(404);
    expect(JSON.parse(captured.body.toString())).toEqual({
      error: "Web UI not installed",
    });
  });

  it("returns JSON 404 'Web UI not installed' for / when index.html missing", () => {
    const captured = mockResponse();
    staticWebUiRoutes({ webUiDir: join(tmpDir, "missing-subdir") })[0].handler(
      mockRequest("/"),
      captured.res,
      {},
    );
    expect(captured.status).toBe(404);
    expect(JSON.parse(captured.body.toString())).toEqual({
      error: "Web UI not installed",
    });
  });

  it("returns JSON 404 'Not found' for /assets/* when no UI directory is configured", () => {
    const captured = mockResponse();
    staticWebUiRoutes()[2].handler(
      mockRequest("/assets/app.js"),
      captured.res,
      { rest: "app.js" },
    );
    expect(captured.status).toBe(404);
    expect(JSON.parse(captured.body.toString())).toEqual({ error: "Not found" });
  });

  it("returns JSON 404 'Not found' for missing assets with a webUiDir option", () => {
    const captured = mockResponse();
    staticWebUiRoutes({ webUiDir: tmpDir })[2].handler(
      mockRequest("/assets/missing.js"),
      captured.res,
      { rest: "missing.js" },
    );
    expect(captured.status).toBe(404);
    expect(JSON.parse(captured.body.toString())).toEqual({ error: "Not found" });
  });
});

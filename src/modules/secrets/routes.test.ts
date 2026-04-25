/**
 * Secrets HTTP route tests — exercise the daemon-side surface that
 * `DaemonControlClient.secrets.{get,set,remove}` calls.
 */

import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSecretStore, resetSecretStore } from "#core/config/secrets.js";
import {
  handleGetSecret,
  handleListSecrets,
  handleRemoveSecret,
  handleSetSecret,
} from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = data ? JSON.parse(data) : null;
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(opts: { url?: string; body?: Record<string, unknown> } = {}) {
  const handlers: Record<string, ((data?: Buffer) => void)[]> = {};
  const req = {
    url: opts.url ?? "/",
    on(event: string, fn: (data?: Buffer) => void) {
      (handlers[event] ??= []).push(fn);
      return req;
    },
    destroy() {},
  } as unknown as IncomingMessage;
  if (opts.body !== undefined) {
    queueMicrotask(() => {
      for (const fn of handlers.data ?? []) {
        fn(Buffer.from(JSON.stringify(opts.body)));
      }
      for (const fn of handlers.end ?? []) {
        fn();
      }
    });
  } else {
    queueMicrotask(() => {
      for (const fn of handlers.end ?? []) {
        fn();
      }
    });
  }
  return req;
}

describe("secrets routes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "secrets-routes-"));
    resetSecretStore();
    initSecretStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetSecretStore();
  });

  describe("handleListSecrets", () => {
    it("returns secrets with names and source after a set", async () => {
      const setReq = mockRequest({ body: { value: "v1", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "ROUTES_TEST_FOO");
      expect(setResp.result.status).toBe(200);

      const { res, result } = mockResponse();
      handleListSecrets(res);
      expect(result.status).toBe(200);
      const body = result.body as { secrets: { name: string; source: string }[] };
      const found = body.secrets.find((s) => s.name === "ROUTES_TEST_FOO");
      expect(found).toBeDefined();
      expect(found?.source).toBe("project-file");
    });
  });

  describe("handleGetSecret", () => {
    it("returns 404 with { found: false } when secret is absent", () => {
      const { res, result } = mockResponse();
      handleGetSecret(res, "MISSING");
      expect(result.status).toBe(404);
      expect(result.body).toEqual({ found: false });
    });

    it("returns 200 with { found: true, value } when secret is present", async () => {
      const setReq = mockRequest({ body: { value: "secret-val", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "API_TOKEN");
      expect(setResp.result.status).toBe(200);

      const { res, result } = mockResponse();
      handleGetSecret(res, "API_TOKEN");
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ found: true, value: "secret-val" });
    });
  });

  describe("handleSetSecret", () => {
    it("rejects when value is missing or empty", async () => {
      const req = mockRequest({ body: { scope: "project" } });
      const { res, result } = mockResponse();
      await handleSetSecret(req, res, "FOO");
      expect(result.status).toBe(400);
    });

    it("rejects when scope is missing or invalid", async () => {
      const req = mockRequest({ body: { value: "x", scope: "weird" } });
      const { res, result } = mockResponse();
      await handleSetSecret(req, res, "FOO");
      expect(result.status).toBe(400);
    });
  });

  describe("handleRemoveSecret", () => {
    it("returns 400 when scope query param is missing or invalid", () => {
      const req = mockRequest({ url: "/api/secrets/FOO" });
      const { res, result } = mockResponse();
      handleRemoveSecret(req, res, "FOO");
      expect(result.status).toBe(400);
    });

    it("returns 404 when secret is absent", () => {
      const req = mockRequest({ url: "/api/secrets/MISSING?scope=project" });
      const { res, result } = mockResponse();
      handleRemoveSecret(req, res, "MISSING");
      expect(result.status).toBe(404);
    });

    it("returns 200 with { ok: true } after removing an existing secret", async () => {
      const setReq = mockRequest({ body: { value: "v", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "TO_DELETE");
      expect(setResp.result.status).toBe(200);

      const removeReq = mockRequest({ url: "/api/secrets/TO_DELETE?scope=project" });
      const { res, result } = mockResponse();
      handleRemoveSecret(removeReq, res, "TO_DELETE");
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });

      const getResp = mockResponse();
      handleGetSecret(getResp.res, "TO_DELETE");
      expect(getResp.result.status).toBe(404);
    });
  });
});

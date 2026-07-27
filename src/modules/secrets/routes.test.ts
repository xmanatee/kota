/**
 * Secrets HTTP route tests — exercise the daemon-side surface that
 * `DaemonControlClient.secrets.{get,set,remove}` calls.
 */

import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSecretStores } from "#core/config/secrets.js";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import { SecretProjectStores } from "./project-scope.js";
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
  let projectStores: SecretProjectStores;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "secrets-routes-"));
    resetSecretStores();
    projectStores = new SecretProjectStores({ defaultProjectDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetSecretStores();
  });

  describe("handleListSecrets", () => {
    it("returns secrets with names and source after a set", async () => {
      const setReq = mockRequest({ body: { value: "v1", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "ROUTES_TEST_FOO", projectStores);
      expect(setResp.result.status).toBe(200);

      const { res, result } = mockResponse();
      handleListSecrets(mockRequest(), res, projectStores);
      expect(result.status).toBe(200);
      const body = result.body as { secrets: { name: string; source: string }[] };
      const found = body.secrets.find((s) => s.name === "ROUTES_TEST_FOO");
      expect(found).toBeDefined();
      expect(found?.source).toBe("project-file");
    });
  });

  describe("handleGetSecret", () => {
    it("returns an explicit absent result when secret is absent", () => {
      const { res, result } = mockResponse();
      handleGetSecret(mockRequest(), res, "MISSING", projectStores);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ found: false });
    });

    it("returns 200 with { found: true, value } when secret is present", async () => {
      const setReq = mockRequest({ body: { value: "secret-val", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "API_TOKEN", projectStores);
      expect(setResp.result.status).toBe(200);

      const { res, result } = mockResponse();
      handleGetSecret(mockRequest(), res, "API_TOKEN", projectStores);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ found: true, value: "secret-val" });
    });
  });

  describe("handleSetSecret", () => {
    it("rejects when value is missing or empty", async () => {
      const req = mockRequest({ body: { scope: "project" } });
      const { res, result } = mockResponse();
      await handleSetSecret(req, res, "FOO", projectStores);
      expect(result.status).toBe(400);
    });

    it("rejects when scope is missing or invalid", async () => {
      const req = mockRequest({ body: { value: "x", scope: "weird" } });
      const { res, result } = mockResponse();
      await handleSetSecret(req, res, "FOO", projectStores);
      expect(result.status).toBe(400);
    });
  });

  describe("handleRemoveSecret", () => {
    it("returns 400 when scope query param is missing or invalid", () => {
      const req = mockRequest({ url: "/api/secrets/FOO" });
      const { res, result } = mockResponse();
      handleRemoveSecret(req, res, "FOO", projectStores);
      expect(result.status).toBe(400);
    });

    it("returns an explicit absent result when secret is absent", () => {
      const req = mockRequest({ url: "/api/secrets/MISSING?scope=project" });
      const { res, result } = mockResponse();
      handleRemoveSecret(req, res, "MISSING", projectStores);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: false, reason: "not_found" });
    });

    it("returns 200 with { ok: true } after removing an existing secret", async () => {
      const setReq = mockRequest({ body: { value: "v", scope: "project" } });
      const setResp = mockResponse();
      await handleSetSecret(setReq, setResp.res, "TO_DELETE", projectStores);
      expect(setResp.result.status).toBe(200);

      const removeReq = mockRequest({ url: "/api/secrets/TO_DELETE?scope=project" });
      const { res, result } = mockResponse();
      handleRemoveSecret(removeReq, res, "TO_DELETE", projectStores);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });

      const getResp = mockResponse();
      handleGetSecret(mockRequest(), getResp.res, "TO_DELETE", projectStores);
      expect(getResp.result.status).toBe(200);
      expect(getResp.result.body).toEqual({ found: false });
    });
  });

  it("isolates list, get, set, and remove across two projects", async () => {
    const secondDir = mkdtempSync(join(tmpdir(), "secrets-routes-second-"));
    const first = buildConfiguredProject({ projectDir: tempDir });
    const second = buildConfiguredProject({ projectDir: secondDir });
    const stores = new SecretProjectStores({
      defaultProjectDir: tempDir,
      projects: [first, second],
      defaultProjectId: first.projectId,
    });

    try {
      const setResponse = mockResponse();
      await handleSetSecret(
        mockRequest({
          url: `/api/secrets/SHARED?projectId=${second.projectId}`,
          body: { value: "second-project-value", scope: "project" },
        }),
        setResponse.res,
        "SHARED",
        stores,
      );
      expect(setResponse.result.status).toBe(200);

      const firstGet = mockResponse();
      handleGetSecret(
        mockRequest({ url: `/api/secrets/SHARED?projectId=${first.projectId}` }),
        firstGet.res,
        "SHARED",
        stores,
      );
      expect(firstGet.result.body).toEqual({ found: false });

      const secondGet = mockResponse();
      handleGetSecret(
        mockRequest({ url: `/api/secrets/SHARED?projectId=${second.projectId}` }),
        secondGet.res,
        "SHARED",
        stores,
      );
      expect(secondGet.result.body).toEqual({
        found: true,
        value: "second-project-value",
      });

      const firstList = mockResponse();
      handleListSecrets(
        mockRequest({ url: `/api/secrets?projectId=${first.projectId}` }),
        firstList.res,
        stores,
      );
      expect(
        (firstList.result.body as { secrets: Array<{ name: string }> }).secrets,
      ).not.toContainEqual(expect.objectContaining({ name: "SHARED" }));

      const removeResponse = mockResponse();
      handleRemoveSecret(
        mockRequest({
          url: `/api/secrets/SHARED?scope=project&projectId=${second.projectId}`,
        }),
        removeResponse.res,
        "SHARED",
        stores,
      );
      expect(removeResponse.result.body).toEqual({ ok: true });

      const secondAfterRemove = mockResponse();
      handleGetSecret(
        mockRequest({ url: `/api/secrets/SHARED?projectId=${second.projectId}` }),
        secondAfterRemove.res,
        "SHARED",
        stores,
      );
      expect(secondAfterRemove.result.body).toEqual({ found: false });
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown project before touching a store", () => {
    const response = mockResponse();
    handleGetSecret(
      mockRequest({ url: "/api/secrets/TOKEN?projectId=missing" }),
      response.res,
      "TOKEN",
      projectStores,
    );
    expect(response.result.status).toBe(404);
    expect(response.result.body).toMatchObject({
      reason: "unknown_project",
      projectId: "missing",
    });
  });
});

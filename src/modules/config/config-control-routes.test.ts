import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configControlRoutes } from "./config-control-routes.js";

const { FAKE_HOME } = vi.hoisted(() => {
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  return { FAKE_HOME: join(tmpdir(), `kota-config-control-home-${Date.now()}`) };
});

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => FAKE_HOME };
});

const SECRET_VALUES = [
  "inline-api-key",
  "inline-token",
  "inline-password",
  "inline-private-key",
  "inline-authorization",
  "inline-cookie",
] as const;

const scopeRoots: string[] = [];

afterEach(() => {
  for (const scopeRoot of scopeRoots.splice(0)) {
    rmSync(scopeRoot, { recursive: true, force: true });
  }
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

function makeScopeRoot(): string {
  const scopeRoot = realpathSync(mkdtempSync(join(tmpdir(), "kota-config-control-")));
  scopeRoots.push(scopeRoot);
  mkdirSync(join(FAKE_HOME, ".kota"), { recursive: true });
  writeFileSync(
    join(FAKE_HOME, ".kota", "config.json"),
    JSON.stringify({ trustedScopes: [scopeRoot] }),
  );
  mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
  writeFileSync(
    join(scopeRoot, ".kota", "config.json"),
    JSON.stringify({
      modules: {
        fixture: {
          apiKey: SECRET_VALUES[0],
          nested: [
            { token: SECRET_VALUES[1] },
            { password: SECRET_VALUES[2] },
            { "private-key": SECRET_VALUES[3] },
            { authorization: SECRET_VALUES[4] },
            { cookie: SECRET_VALUES[5] },
          ],
          label: "visible-label",
        },
      },
    }),
  );
  return scopeRoot;
}

function mockResponse(): {
  res: ServerResponse;
  result: { status: number; body: unknown };
} {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

async function requestConfigRoute(
  scopeRoot: string,
  path: "/config/validate" | `/config/value?${string}`,
): Promise<{ status: number; body: unknown }> {
  const routePath = path.split("?", 1)[0];
  const route = configControlRoutes({
    cwd: scopeRoot,
    getRegisteredConfigKeys: () => new Set(["modules"]),
  }).find((candidate) => candidate.method === "GET" && candidate.path === routePath);
  if (!route) throw new Error(`Missing GET ${routePath} config control route`);
  const { res, result } = mockResponse();
  await route.handler({ url: path } as IncomingMessage, res, {});
  return result;
}

function expectNoInlineSecrets(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const secret of SECRET_VALUES) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).toContain("visible-label");
}

describe("config daemon-control redaction", () => {
  it("recursively masks secret-shaped fields in remotely validated config", async () => {
    const result = await requestConfigRoute(makeScopeRoot(), "/config/validate");

    expect(result.status).toBe(200);
    expectNoInlineSecrets(result.body);
  });

  it("masks a sensitive requested leaf and secret-shaped descendants of a parent value", async () => {
    const scopeRoot = makeScopeRoot();
    const parent = await requestConfigRoute(
      scopeRoot,
      "/config/value?key=modules.fixture",
    );
    const leaf = await requestConfigRoute(
      scopeRoot,
      "/config/value?key=modules.fixture.apiKey",
    );

    expect(parent.status).toBe(200);
    expectNoInlineSecrets(parent.body);
    expect(leaf).toEqual({
      status: 200,
      body: { found: true, value: "***" },
    });
  });
});

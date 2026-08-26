import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  fetchAuthorized,
  pollControlFile,
  pollControlFileReplacement,
  waitForExit,
} from "#core/daemon/built-cli-daemon-test-support.integration.js";
import {
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  scopeAuthorityOperatorChallengeForInteractiveClient,
  scopeAuthorityOperatorHeadersForInteractiveClient,
  scopeAuthorityOperatorTokenPath,
} from "#core/daemon/scope-authority-operator-token.js";
import type { ScopeAuthorityOperatorActionValue } from "#core/daemon/scope-authority-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");
const SCOPE_ROUTE = "/api/scope-authority-fixture";

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(`dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before this test.`);
  }
});

describe("built CLI live trust revocation", () => {
  let child: ChildProcess | null = null;
  let scopeRoot = "";

  afterEach(async () => {
    if (child && !child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      if (await waitForExit(child, 8_000) === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    }
    if (scopeRoot) rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("quarantines and restarts away installed modules when live trust is revoked", async () => {
    scopeRoot = join(
      tmpdir(),
      `kota-built-cli-authority-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const stateDir = join(scopeRoot, ".kota");
    const homeDir = join(scopeRoot, "home");
    const globalConfigPath = join(homeDir, ".kota", "config.json");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(homeDir, ".kota"), { recursive: true });
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [scopeRoot] }));
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ defaultAgentHarness: "codex" }),
    );
    writeScopeAuthorityRouteModule(stateDir);

    child = spawn(
      process.execPath,
      [CLI_PATH, "daemon", "--scope-root", scopeRoot, "--log-format", "json"],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          KOTA_SCOPE_ROOT: scopeRoot,
          KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH: "",
          NODE_OPTIONS: "",
        },
      },
    );
    const exited = new Promise<number>((resolveExit) => {
      child!.once("exit", (code) => resolveExit(code ?? -1));
    });
    const firstAddress = await pollControlFile(stateDir, 25_000, exited);
    expect((await fetchAuthorized(firstAddress.port, SCOPE_ROUTE, firstAddress.token)).status)
      .toBe(200);

    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const operatorToken = JSON.parse(
      readFileSync(scopeAuthorityOperatorTokenPath(globalConfigPath), "utf8"),
    ).token as string;
    const revokeBody = JSON.stringify({
      expectedRevision: 0,
      reason: "Revoke the live scope's repository-controlled runtime authority.",
      trust: false,
    });
    const operatorHeaders = await interactiveAuthorityHeaders(
      firstAddress,
      scopeAuthorityOperatorTokenPath(globalConfigPath),
      scopeId,
      revokeBody,
      "apply",
    );
    expect(JSON.stringify(operatorHeaders)).not.toContain(operatorToken);
    const revoke = await fetchAuthorized(
      firstAddress.port,
      `/scopes/${scopeId}/authority`,
      firstAddress.token,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...operatorHeaders,
        },
        body: revokeBody,
      },
    );
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({
      ok: true,
      authority: { trust: { trusted: false, source: "default-untrusted" } },
    });

    expect([503, "closed"]).toContain(await fetchStatusOrClosed(
      firstAddress.port,
      firstAddress.token,
    ));
    const secondAddress = await pollControlFileReplacement(
      stateDir,
      firstAddress,
      25_000,
      exited,
    );
    expect((await fetchAuthorized(secondAddress.port, SCOPE_ROUTE, secondAddress.token)).status)
      .toBe(404);
    const authority = await fetchAuthorized(
      secondAddress.port,
      `/scopes/${scopeId}/authority`,
      secondAddress.token,
    );
    expect(authority.status).toBe(200);
    expect(await authority.json()).toMatchObject({
      revision: 1,
      trust: { trusted: false, source: "default-untrusted" },
    });

    child.kill("SIGTERM");
    expect(await waitForExit(child, 10_000)).toBe(0);
  }, 80_000);
});

async function fetchStatusOrClosed(port: number, token: string): Promise<number | "closed"> {
  try {
    return (await fetchAuthorized(port, SCOPE_ROUTE, token)).status;
  } catch {
    return "closed";
  }
}

async function interactiveAuthorityHeaders(
  address: { port: number; token: string },
  tokenPath: string,
  scopeId: string,
  body: string,
  value: ScopeAuthorityOperatorActionValue,
): Promise<Record<string, string>> {
  const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
  const priorSessionId = process.env.KOTA_SESSION_ID;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;
  delete process.env.KOTA_SESSION_ID;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    const challenge = scopeAuthorityOperatorChallengeForInteractiveClient();
    if (!challenge.ok) throw new Error(challenge.message);
    const response = await fetchAuthorized(
      address.port,
      SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
      address.token,
      {
        method: "POST",
        headers: {
          [SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER]: challenge.challenge,
        },
      },
    );
    const challengeBody = await response.json() as { proof?: string };
    const signed = scopeAuthorityOperatorHeadersForInteractiveClient(
      { value, scopeId, body, challenge: challenge.challenge },
      challengeBody.proof,
    );
    if (!signed.ok) throw new Error(signed.message);
    return signed.headers;
  } finally {
    if (ttyDescriptor === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    if (priorTokenPath === undefined) {
      delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    } else {
      process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
    }
    if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
    else process.env.KOTA_SESSION_ID = priorSessionId;
  }
}

function writeScopeAuthorityRouteModule(stateDir: string): void {
  const moduleDir = join(stateDir, "modules", "scope-authority-fixture");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "index.mjs"), `export default {
  name: "scope-authority-fixture",
  version: "1.0.0",
  description: "Live scope trust revocation fixture",
  routes: () => [{
    method: "GET",
    path: "${SCOPE_ROUTE}",
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ source: "trusted-scope-module" }));
    }
  }]
};\n`);
}

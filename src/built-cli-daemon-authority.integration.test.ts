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
  realLoopbackAvailable,
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
const PROJECT_ROUTE = "/api/project-authority-fixture";

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(`dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before this test.`);
  }
});

describe.skipIf(!realLoopbackAvailable())("built CLI live trust revocation", () => {
  let child: ChildProcess | null = null;
  let projectDir = "";

  afterEach(async () => {
    if (child && !child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      if (await waitForExit(child, 8_000) === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it("quarantines and restarts away project modules when live trust is revoked", async () => {
    projectDir = join(
      tmpdir(),
      `kota-built-cli-authority-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const stateDir = join(projectDir, ".kota");
    const homeDir = join(projectDir, "home");
    const globalConfigPath = join(homeDir, ".kota", "config.json");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(homeDir, ".kota"), { recursive: true });
    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [projectDir] }));
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ defaultAgentHarness: "claude-agent-sdk" }),
    );
    writeProjectAuthorityRouteModule(stateDir);

    child = spawn(
      process.execPath,
      [CLI_PATH, "daemon", "--project-dir", projectDir, "--log-format", "json"],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          KOTA_PROJECT_DIR: projectDir,
          KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH: "",
          NODE_OPTIONS: "",
        },
      },
    );
    const exited = new Promise<number>((resolveExit) => {
      child!.once("exit", (code) => resolveExit(code ?? -1));
    });
    const firstAddress = await pollControlFile(stateDir, 25_000, exited);
    expect((await fetchAuthorized(firstAddress.port, PROJECT_ROUTE, firstAddress.token)).status)
      .toBe(200);

    const scopeId = deriveDirectoryScopeId(projectDir);
    const operatorToken = JSON.parse(
      readFileSync(scopeAuthorityOperatorTokenPath(globalConfigPath), "utf8"),
    ).token as string;
    const revokeBody = JSON.stringify({
      expectedRevision: 0,
      reason: "Revoke the live project's repo-controlled runtime authority.",
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
    expect((await fetchAuthorized(secondAddress.port, PROJECT_ROUTE, secondAddress.token)).status)
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
    return (await fetchAuthorized(port, PROJECT_ROUTE, token)).status;
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

function writeProjectAuthorityRouteModule(stateDir: string): void {
  const moduleDir = join(stateDir, "modules", "project-authority-fixture");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "index.mjs"), `export default {
  name: "project-authority-fixture",
  version: "1.0.0",
  description: "Live project trust revocation fixture",
  routes: () => [{
    method: "GET",
    path: "${PROJECT_ROUTE}",
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ source: "trusted-project-module" }));
    }
  }]
};\n`);
}

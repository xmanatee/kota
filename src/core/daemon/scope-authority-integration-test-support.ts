import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { Daemon } from "./daemon.js";
import {
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  scopeAuthorityOperatorChallengeForInteractiveClient,
  scopeAuthorityOperatorHeadersForInteractiveClient,
} from "./scope-authority-operator-token.js";
import type { ScopeAuthorityOperatorActionValue } from "./scope-authority-types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type ControlAddress = { port: number; token: string };

export async function startDaemon(daemon: Daemon, stateDir: string): Promise<{
  address: ControlAddress;
  startPromise: Promise<void>;
}> {
  const controlPath = join(stateDir, "daemon-control.json");
  const startPromise = daemon.start();
  await waitFor(() => existsSync(controlPath));
  const address = JSON.parse(readFileSync(controlPath, "utf8")) as ControlAddress;
  return { address, startPromise };
}

export async function request(
  address: ControlAddress,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${address.token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return {
    status: response.status,
    body: JSON.parse(await response.text()) as JsonObject,
  };
}

export async function interactiveAuthorityHeaders(
  address: ControlAddress,
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
    const response = await request(address, SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH, {
      method: "POST",
      headers: {
        [SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER]: challenge.challenge,
      },
    });
    const signed = scopeAuthorityOperatorHeadersForInteractiveClient(
      { value, scopeId, body, challenge: challenge.challenge },
      typeof response.body.proof === "string" ? response.body.proof : undefined,
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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(predicate()).toBe(true);
}

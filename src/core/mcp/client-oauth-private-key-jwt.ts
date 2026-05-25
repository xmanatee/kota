import { Buffer } from "node:buffer";
import {
  createPrivateKey,
  createSign,
  type KeyObject,
  randomUUID,
} from "node:crypto";
import type {
  McpOAuthClientCredentialsPrivateKeyJwtSigningAlgorithm,
  NormalizedMcpOAuthClientCredentialsPrivateKeyJwtClient,
} from "./client-auth-types.js";

export const MCP_PRIVATE_KEY_JWT_CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const PRIVATE_KEY_JWT_LIFETIME_SECONDS = 300;

type JwtHeader = {
  alg: McpOAuthClientCredentialsPrivateKeyJwtSigningAlgorithm;
  typ: "JWT";
  kid?: string;
};

type JwtPayload = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};

export function validatePrivateKeyJwtSigningConfig(
  client: NormalizedMcpOAuthClientCredentialsPrivateKeyJwtClient,
): void {
  assertSupportedPrivateKeyJwtAlgorithm(client.signingAlgorithm);
  const key = loadPrivateKey(client.privateKeyPem);
  signPrivateKeyJwtInput("kota-private-key-jwt-validation", key);
}

export function createPrivateKeyJwtClientAssertion(
  client: NormalizedMcpOAuthClientCredentialsPrivateKeyJwtClient,
  audience: string,
): string {
  assertSupportedPrivateKeyJwtAlgorithm(client.signingAlgorithm);
  const issuedAt = Math.floor(Date.now() / 1000);
  const header: JwtHeader = {
    alg: client.signingAlgorithm,
    typ: "JWT",
    ...(client.keyId !== undefined ? { kid: client.keyId } : {}),
  };
  const payload: JwtPayload = {
    iss: client.clientId,
    sub: client.clientId,
    aud: audience,
    iat: issuedAt,
    exp: issuedAt + PRIVATE_KEY_JWT_LIFETIME_SECONDS,
    jti: randomUUID(),
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = signPrivateKeyJwtInput(signingInput, loadPrivateKey(client.privateKeyPem));
  return `${signingInput}.${base64Url(signature)}`;
}

function assertSupportedPrivateKeyJwtAlgorithm(
  algorithm: McpOAuthClientCredentialsPrivateKeyJwtSigningAlgorithm,
): void {
  if (algorithm !== "RS256") {
    throw new Error(
      "OAuth client credentials private_key_jwt signingAlgorithm must be RS256",
    );
  }
}

function loadPrivateKey(privateKeyPem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error(
      "OAuth client credentials privateKeyPem must be a valid PEM private key",
    );
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "rsa") {
    throw new Error(
      "OAuth client credentials privateKeyPem must be an RSA private key usable with RS256",
    );
  }
  return key;
}

function signPrivateKeyJwtInput(input: string, key: KeyObject): Buffer {
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  try {
    return signer.sign(key);
  } catch {
    throw new Error(
      "OAuth client credentials privateKeyPem must be an RSA private key usable with RS256",
    );
  }
}

function base64UrlJson(value: JwtHeader | JwtPayload): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

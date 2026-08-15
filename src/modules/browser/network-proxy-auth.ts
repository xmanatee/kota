import { randomBytes, timingSafeEqual } from "node:crypto";

export type BrowserProxyCredentials = {
  readonly username: string;
  readonly password: string;
  readonly authorization: string;
};

export function createBrowserProxyCredentials(): BrowserProxyCredentials {
  const username = `kota-${randomBytes(12).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  return {
    username,
    password,
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

export function browserProxyCredentialsMatch(
  provided: string | string[] | undefined,
  credentials: BrowserProxyCredentials,
): boolean {
  if (typeof provided !== "string") return false;
  const actual = Buffer.from(provided);
  const expected = Buffer.from(credentials.authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

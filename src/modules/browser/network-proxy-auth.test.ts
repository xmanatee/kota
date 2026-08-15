import { describe, expect, it } from "vitest";
import {
  browserProxyCredentialsMatch,
  createBrowserProxyCredentials,
} from "./network-proxy-auth.js";

describe("browser proxy credentials", () => {
  it("generates independent credentials and compares their header exactly", () => {
    const first = createBrowserProxyCredentials();
    const second = createBrowserProxyCredentials();

    expect(first.username).not.toBe(second.username);
    expect(first.password).not.toBe(second.password);
    expect(browserProxyCredentialsMatch(first.authorization, first)).toBe(true);
    expect(browserProxyCredentialsMatch(second.authorization, first)).toBe(false);
    expect(browserProxyCredentialsMatch(undefined, first)).toBe(false);
  });
});

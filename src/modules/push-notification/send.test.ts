/**
 * Verifies the Expo Push API payload shapes for the two delivery paths the
 * push-notification module owns:
 *
 * - `sendPushNotifications` for `approval.requested` — mobile app deep-links
 *   into the approval surface and dynamic resolution action by stable graph ids.
 * - `sendDigestPushNotifications` for `workflow.daily.digest` and
 *   `workflow.attention.digest`. Both surfaces share the body-preview pipeline;
 *   their graph-owned surface id is the only discriminator.
 *
 * A regression in either payload silently breaks mobile push deep-linking,
 * so each shape is pinned exactly here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { sendDigestPushNotifications, sendPushNotifications } from "./send.js";
import { loadStore, PushTokenStoreError, registerPushToken } from "./store.js";

describe("push-token persistence", () => {
  it("migrates the legacy document and writes the versioned shape atomically", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-push-store-"));
    try {
      mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
      writeFileSync(join(scopeRoot, ".kota/push-tokens.json"), JSON.stringify({ tokens: {} }));

      expect(loadStore(scopeRoot)).toEqual({ schemaVersion: 1, tokens: {} });
      registerPushToken(scopeRoot, "device-a", "ExponentPushToken[aaa]");
      expect(JSON.parse(
        readFileSync(join(scopeRoot, ".kota/push-tokens.json"), "utf8"),
      )).toMatchObject({ schemaVersion: 1 });
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("reports malformed durable data instead of silently dropping registrations", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-push-store-invalid-"));
    try {
      mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
      const path = join(scopeRoot, ".kota/push-tokens.json");
      const malformed = JSON.stringify({ schemaVersion: 1, tokens: { device: { token: 7 } } });
      writeFileSync(path, malformed);

      expect(() => loadStore(scopeRoot)).toThrowError(PushTokenStoreError);
      expect(readFileSync(path, "utf8")).toBe(malformed);
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});

describe("push-notification send paths", () => {
  let scopeRoot: string;
  let fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>>;
  const http = outboundHttpRequestPort((request) =>
    fetchMock(String(request.url), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    })
  );

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-push-send-"));
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota/push-tokens.json"),
      JSON.stringify({
        tokens: {
          "device-a": {
            deviceId: "device-a",
            token: "ExponentPushToken[aaa]",
            registeredAt: "2026-01-01T00:00:00.000Z",
          },
          "device-b": {
            deviceId: "device-b",
            token: "ExponentPushToken[bbb]",
            registeredAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  describe("sendPushNotifications (approvals)", () => {
    it("sends one Expo Push API message per registered device with the deep-link payload", async () => {
      await sendPushNotifications(
        scopeRoot,
        {
          approvalId: "approval-42",
          tool: "shell",
          risk: "moderate",
          source: "session",
        },
        vi.fn(),
        http,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://exp.host/--/expo-server/push/send");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Accept).toBe("application/json");

      const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
      expect(body).toEqual([
        {
          to: "ExponentPushToken[aaa]",
          sound: "default",
          title: "session — shell",
          body: "Risk: moderate",
          data: {
            surfaceId: "approvals",
            actionId: "approval.resolve-approval-42",
          },
        },
        {
          to: "ExponentPushToken[bbb]",
          sound: "default",
          title: "session — shell",
          body: "Risk: moderate",
          data: {
            surfaceId: "approvals",
            actionId: "approval.resolve-approval-42",
          },
        },
      ]);
    });

    it("falls back to 'Approval: <tool>' when source is empty", async () => {
      await sendPushNotifications(
        scopeRoot,
        { approvalId: "x", tool: "shell", risk: "safe", source: "" },
        vi.fn(),
        http,
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ title: string }>;
      expect(body[0].title).toBe("Approval: shell");
    });

    it("does not call the Expo Push API when no devices are registered", async () => {
      writeFileSync(
        join(scopeRoot, ".kota/push-tokens.json"),
        JSON.stringify({ tokens: {} }),
      );
      await sendPushNotifications(
        scopeRoot,
        { approvalId: "x", tool: "y", risk: "z", source: "s" },
        vi.fn(),
        http,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logs Expo HTTP failures through the supplied log function (fire-and-forget)", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("server error", { status: 500, statusText: "Internal Server Error" }),
      );
      const log = vi.fn();
      await sendPushNotifications(
        scopeRoot,
        { approvalId: "x", tool: "y", risk: "z", source: "s" },
        log,
        http,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/Expo Push API error: 500/);
    });

    it("logs network failures and resolves (no rethrow)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      const log = vi.fn();
      await expect(
        sendPushNotifications(
          scopeRoot,
          { approvalId: "x", tool: "y", risk: "z", source: "s" },
          log,
          http,
        ),
      ).resolves.toBeUndefined();
      expect(log.mock.calls[0][0]).toMatch(/Failed to send push notifications: ECONNRESET/);
    });
  });

  describe("sendDigestPushNotifications (digest)", () => {
    it("sends one digest message per registered device with the digest deep-link payload", async () => {
      await sendDigestPushNotifications(
        scopeRoot,
        {
          title: "KOTA daily digest",
          body: "Daily digest 2026-04-26\n- builder committed: Add foo",
          surfaceId: "daily-digest",
        },
        vi.fn(),
        http,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://exp.host/--/expo-server/push/send");
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
      expect(body).toEqual([
        {
          to: "ExponentPushToken[aaa]",
          sound: "default",
          title: "KOTA daily digest",
          body: "Daily digest 2026-04-26",
          data: { surfaceId: "daily-digest" },
        },
        {
          to: "ExponentPushToken[bbb]",
          sound: "default",
          title: "KOTA daily digest",
          body: "Daily digest 2026-04-26",
          data: { surfaceId: "daily-digest" },
        },
      ]);
    });

    it("targets the shared inbox with an attention-posture title for workflow.attention.digest", async () => {
      await sendDigestPushNotifications(
        scopeRoot,
        {
          title: "KOTA needs your attention",
          body: "3 items need attention",
          surfaceId: "inbox",
        },
        vi.fn(),
        http,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
      expect(body[0]).toEqual({
        to: "ExponentPushToken[aaa]",
        sound: "default",
        title: "KOTA needs your attention",
        body: "3 items need attention",
        data: { surfaceId: "inbox" },
      });
      expect((body[1] as { data: { surfaceId: string } }).data.surfaceId).toBe("inbox");
    });

    it("truncates the body preview to keep payload under Expo limits", async () => {
      const longLine = "x".repeat(500);
      await sendDigestPushNotifications(
        scopeRoot,
        { title: "KOTA daily digest", body: longLine, surfaceId: "daily-digest" },
        vi.fn(),
        http,
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ body: string }>;
      expect(body[0].body.length).toBeLessThanOrEqual(140);
      expect(body[0].body.endsWith("…")).toBe(true);
    });

    it("skips blank leading lines when previewing the body", async () => {
      await sendDigestPushNotifications(
        scopeRoot,
        {
          title: "KOTA daily digest",
          body: "\n\n  \nReal first line\nSecond line",
          surfaceId: "daily-digest",
        },
        vi.fn(),
        http,
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ body: string }>;
      expect(body[0].body).toBe("Real first line");
    });

    it("does not call the Expo Push API when no devices are registered", async () => {
      writeFileSync(
        join(scopeRoot, ".kota/push-tokens.json"),
        JSON.stringify({ tokens: {} }),
      );
      await sendDigestPushNotifications(
        scopeRoot,
        { title: "KOTA daily digest", body: "anything", surfaceId: "daily-digest" },
        vi.fn(),
        http,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logs Expo HTTP failures through the supplied log function", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("server error", { status: 500, statusText: "Internal Server Error" }),
      );
      const log = vi.fn();
      await sendDigestPushNotifications(
        scopeRoot,
        { title: "KOTA daily digest", body: "x", surfaceId: "daily-digest" },
        log,
        http,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/Expo Push API error: 500/);
    });
  });
});

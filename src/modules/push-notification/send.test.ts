/**
 * Verifies the Expo Push API payload shapes for the two delivery paths the
 * push-notification module owns:
 *
 * - `sendPushNotifications` for `approval.requested` — mobile app deep-links
 *   into the approval queue using `data.screen = "approvals"` +
 *   `data.approvalId`.
 * - `sendDigestPushNotifications` for `workflow.daily.digest` and
 *   `workflow.attention.digest` — mobile app deep-links into DigestScreen
 *   using `data.screen = "digest"`. The body is a short preview of the
 *   rendered digest text; the screen refetches the full payload from
 *   `/api/digest`.
 *
 * A regression in either payload silently breaks mobile push deep-linking,
 * so each shape is pinned exactly here.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDigestPushNotifications, sendPushNotifications } from "./send.js";

describe("push-notification send paths", () => {
  let projectDir: string;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-push-send-"));
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota/push-tokens.json"),
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

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("sendPushNotifications (approvals)", () => {
    it("sends one Expo Push API message per registered device with the deep-link payload", async () => {
      await sendPushNotifications(
        projectDir,
        {
          approvalId: "approval-42",
          tool: "shell",
          risk: "moderate",
          source: "session",
        },
        vi.fn(),
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
          data: { screen: "approvals", approvalId: "approval-42" },
        },
        {
          to: "ExponentPushToken[bbb]",
          sound: "default",
          title: "session — shell",
          body: "Risk: moderate",
          data: { screen: "approvals", approvalId: "approval-42" },
        },
      ]);
    });

    it("falls back to 'Approval: <tool>' when source is empty", async () => {
      await sendPushNotifications(
        projectDir,
        { approvalId: "x", tool: "shell", risk: "safe", source: "" },
        vi.fn(),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ title: string }>;
      expect(body[0].title).toBe("Approval: shell");
    });

    it("does not call the Expo Push API when no devices are registered", async () => {
      writeFileSync(
        join(projectDir, ".kota/push-tokens.json"),
        JSON.stringify({ tokens: {} }),
      );
      await sendPushNotifications(
        projectDir,
        { approvalId: "x", tool: "y", risk: "z", source: "s" },
        vi.fn(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logs Expo HTTP failures through the supplied log function (fire-and-forget)", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("server error", { status: 500, statusText: "Internal Server Error" }),
      );
      const log = vi.fn();
      await sendPushNotifications(
        projectDir,
        { approvalId: "x", tool: "y", risk: "z", source: "s" },
        log,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/Expo Push API error: 500/);
    });

    it("logs network failures and resolves (no rethrow)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      const log = vi.fn();
      await expect(
        sendPushNotifications(
          projectDir,
          { approvalId: "x", tool: "y", risk: "z", source: "s" },
          log,
        ),
      ).resolves.toBeUndefined();
      expect(log.mock.calls[0][0]).toMatch(/Failed to send push notifications: ECONNRESET/);
    });
  });

  describe("sendDigestPushNotifications (digest)", () => {
    it("sends one digest message per registered device with the digest deep-link payload", async () => {
      await sendDigestPushNotifications(
        projectDir,
        {
          title: "KOTA daily digest",
          body: "Daily digest 2026-04-26\n- builder committed: Add foo",
        },
        vi.fn(),
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
          data: { screen: "digest" },
        },
        {
          to: "ExponentPushToken[bbb]",
          sound: "default",
          title: "KOTA daily digest",
          body: "Daily digest 2026-04-26",
          data: { screen: "digest" },
        },
      ]);
    });

    it("uses a distinct attention-posture title for workflow.attention.digest", async () => {
      await sendDigestPushNotifications(
        projectDir,
        {
          title: "KOTA needs your attention",
          body: "3 items need attention",
        },
        vi.fn(),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ title: string; body: string }>;
      expect(body[0].title).toBe("KOTA needs your attention");
      expect(body[0].body).toBe("3 items need attention");
    });

    it("truncates the body preview to keep payload under Expo limits", async () => {
      const longLine = "x".repeat(500);
      await sendDigestPushNotifications(
        projectDir,
        { title: "KOTA daily digest", body: longLine },
        vi.fn(),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ body: string }>;
      expect(body[0].body.length).toBeLessThanOrEqual(140);
      expect(body[0].body.endsWith("…")).toBe(true);
    });

    it("skips blank leading lines when previewing the body", async () => {
      await sendDigestPushNotifications(
        projectDir,
        {
          title: "KOTA daily digest",
          body: "\n\n  \nReal first line\nSecond line",
        },
        vi.fn(),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<{ body: string }>;
      expect(body[0].body).toBe("Real first line");
    });

    it("does not call the Expo Push API when no devices are registered", async () => {
      writeFileSync(
        join(projectDir, ".kota/push-tokens.json"),
        JSON.stringify({ tokens: {} }),
      );
      await sendDigestPushNotifications(
        projectDir,
        { title: "KOTA daily digest", body: "anything" },
        vi.fn(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logs Expo HTTP failures through the supplied log function", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("server error", { status: 500, statusText: "Internal Server Error" }),
      );
      const log = vi.fn();
      await sendDigestPushNotifications(
        projectDir,
        { title: "KOTA daily digest", body: "x" },
        log,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/Expo Push API error: 500/);
    });
  });
});

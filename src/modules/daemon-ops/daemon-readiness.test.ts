import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDaemonControlPlaneReady,
  waitForDaemonControlPlane,
} from "./daemon-readiness.js";

const readLiveDaemonControlAddressMock = vi.hoisted(() => vi.fn());
const isDaemonControlAddressReachableMock = vi.hoisted(() => vi.fn());

vi.mock("#core/server/daemon-control-address.js", () => ({
  readLiveDaemonControlAddress: readLiveDaemonControlAddressMock,
  isDaemonControlAddressReachable: isDaemonControlAddressReachableMock,
}));

beforeEach(() => {
  readLiveDaemonControlAddressMock.mockReset();
  isDaemonControlAddressReachableMock.mockReset();
});

describe("daemon control-plane readiness", () => {
  it("is ready only when a live published address answers its health probe", async () => {
    const address = { pid: 1234, port: 4312, token: "test-token" };
    readLiveDaemonControlAddressMock.mockReturnValue(address);
    isDaemonControlAddressReachableMock.mockResolvedValue(true);

    await expect(isDaemonControlPlaneReady("/project")).resolves.toBe(true);
    expect(isDaemonControlAddressReachableMock).toHaveBeenCalledWith(address);
  });

  it("waits across missing and unavailable addresses until one becomes ready", async () => {
    const address = { pid: 1234, port: 4312, token: "test-token" };
    readLiveDaemonControlAddressMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(address)
      .mockReturnValue(address);
    isDaemonControlAddressReachableMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(waitForDaemonControlPlane("/project", {
      timeoutMs: 100,
      pollMs: 1,
    })).resolves.toBe(true);
  });

  it("returns false at the bounded readiness deadline", async () => {
    readLiveDaemonControlAddressMock.mockReturnValue(null);
    await expect(waitForDaemonControlPlane("/project", {
      timeoutMs: 1,
      pollMs: 1,
    })).resolves.toBe(false);
  });
});

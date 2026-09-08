import { expect, it, vi } from "vitest";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import { handleResolvedTelegramStatusCommand } from "./status-commands.js";

// Parsing is Telegram-owned; result variants and mutation transitions are not.
it("preserves target and identifier when parsing explicit Telegram write commands", async () => {
  const capture = vi.fn<CaptureClient["capture"]>(async () => ({
    ok: false, reason: "ambiguous", suggestions: [],
  }));
  const retract = vi.fn<RetractClient["retract"]>(async request => ({
    ok: false, reason: "not_found", ...request,
  }));
  const client = createKotaClientTestDouble({ capture: { capture }, retract: { retract } });
  const sendPlain = vi.fn();
  const sendMarkdown = vi.fn();
  const scope = {
    ...client,
    scopeRoot: "/unused",
    getStatusInfo: () => { throw new Error("write commands do not read workflow status"); },
  };
  for (const target of ["memory", "knowledge", "tasks", "inbox"]) {
    await handleResolvedTelegramStatusCommand({ text: `/capture-to-${target}  body with spaces `, scope, sendPlain, sendMarkdown });
    expect(capture).toHaveBeenLastCalledWith("body with spaces", { target });
    await handleResolvedTelegramStatusCommand({ text: `/retract-${target}  record-1 `, scope, sendPlain, sendMarkdown });
    expect(retract).toHaveBeenLastCalledWith({ target, identifier: "record-1" });
  }
  expect(sendPlain).toHaveBeenCalledTimes(8);
  expect(sendMarkdown).not.toHaveBeenCalled();
});

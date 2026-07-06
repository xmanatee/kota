import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { handleResumeWorkflow } from "./daemon-control-workflow.js";

const DIRTY_RECOVERY_ACTION =
  "Clean or stash the dirty checkout, then run `kota workflow resume`.";

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  await closeServer?.();
  closeServer = null;
});

function recoveryBlockedHandle(): DaemonControlHandle {
  return {
    getActiveProjectId: vi.fn(() => null),
    hasProject: vi.fn(() => true),
    resumeWorkflowDispatch: vi.fn(() => ({
      already: true,
      blocked: "dirty-recovery" as const,
      message: DIRTY_RECOVERY_ACTION,
    })),
  } as unknown as DaemonControlHandle;
}

async function serveResumeHandler(handle: DaemonControlHandle): Promise<number> {
  const server = createServer((req, res) => {
    handleResumeWorkflow(
      handle,
      res,
      new URL(req.url ?? "/workflow/resume", "http://127.0.0.1"),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return address.port;
}

describe("daemon workflow control recovery responses", () => {
  it("reports dirty-recovery blocks without resuming dispatch", async () => {
    const port = await serveResumeHandler(recoveryBlockedHandle());
    const res = await fetch(`http://127.0.0.1:${port}/workflow/resume`, {
      method: "POST",
    });

    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      paused: true,
      already: true,
      blocked: "dirty-recovery",
      message: DIRTY_RECOVERY_ACTION,
    });
  });
});

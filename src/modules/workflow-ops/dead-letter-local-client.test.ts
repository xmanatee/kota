import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkflowDispatchDeadLetter,
  deadLetterStoreForProject,
} from "#core/daemon/dead-letter-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import workflowOpsModule from "./index.js";

describe("workflow-ops local dead-letter client", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-dead-letter-client-"));
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("lists, exports, and mutates without runtime event authority", async () => {
    const dlq = deadLetterStoreForProject(projectDir);
    const item = createWorkflowDispatchDeadLetter({
      store: dlq,
      scopeId: "scope-a",
      workflowName: "telegram-ingest",
      trigger: {
        event: "telegram.message",
        schemaRef: null,
        eventId: "evtj-000000000001",
        payload: { chatId: "chat-1", botToken: "secret" },
      },
      reason: "schema mismatch",
      errorClass: "validation",
    });
    const handlers = workflowOpsModule.localClient!({
      cwd: projectDir,
    } as ModuleContext);
    if (!handlers.workflow) throw new Error("workflow handler missing");
    const handler = handlers.workflow;

    const listed = await handler.listDeadLetters({ workflow: "telegram-ingest" });
    expect(listed.items.map((entry) => entry.id)).toEqual([item.id]);
    expect(listed.counts).toEqual({ open: 1, dismissed: 0, redriven: 0 });
    expect(await handler.getDeadLetter(item.id)).toMatchObject({
      found: true,
      item: { id: item.id },
    });
    expect(await handler.exportDeadLetterDiagnostics(item.id)).toMatchObject({
      item: { id: item.id },
    });

    expect(
      await handler.redriveDeadLetter(item.id, {
        reason: "schema fixed",
        target: "simulation",
      }),
    ).toMatchObject({ ok: true, item: { id: item.id, status: "redriven" } });
    expect(await handler.dismissDeadLetter(item.id, "operator closed")).toMatchObject({
      ok: true,
      item: { id: item.id, status: "dismissed" },
    });

    expect(deadLetterStoreForProject(projectDir).get(item.id)).toMatchObject({
      status: "dismissed",
      dismissalReason: "operator closed",
    });
  });
});

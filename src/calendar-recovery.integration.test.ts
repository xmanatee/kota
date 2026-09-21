import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { approvedApprovalResponse, prepareApprovalExecutionBatch, withApprovalExecutionLeases } from "#modules/approval-queue/approval-execution.js";
import { makeCalendarCreateTools } from "#modules/google-workspace/calendar-create.js";
import { CalendarProvider, meeting } from "#modules/google-workspace/calendar-provider.integration.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.reverse()) dispose(); cleanup.length = 0; });

// Detects loss of operation identity between tool approval, delayed queue execution,
// persistent intent and provider reconciliation. HTTP and approval owners are real.
it.each(["inline", "queued"] as const)("recovers committed and uncommitted Calendar writes through %s approval", async (approval) => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-journey-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const scopeId = "calendar-journey";
  let store = new IdempotencyStore(join(dir, "idempotency"), scopeId);
  const queue = new ApprovalQueue(join(dir, "approvals"), null, { scopeId });
  const provider = new CalendarProvider();
  const definitions = makeCalendarCreateTools({ getToken: async () => "controlled-token", calendarId: "primary", defaultScopeId: scopeId, resolveStore: (scope) => scope === scopeId ? store : null, http: provider.http });
  for (const def of definitions) cleanup.push(registerTool(def.tool, def.runner, "google-workspace", { effect: def.effect }));
  const transcript: Array<{ action: string; output: unknown; posts: number; events: number }> = [];
  const record = (action: string, output: unknown) => transcript.push({ action, output, posts: provider.posts.length, events: provider.events.size });
  let call = 0;
  async function invoke(name: string, input: ReturnType<typeof meeting>, authorize = true) {
    const output = await executeToolCalls([{ type: "tool_use", id: `call-${++call}`, name, input }], {
      resultLimit: 8000, verbose: false, autonomyMode: "supervised", approvalQueue: queue,
      scopeId, cwd: dir, scopeRoot: dir, idempotencyStore: store,
      guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
      ...(approval === "inline" || name === "calendar_check_event" || !authorize ? { clientApprovalResolver: async () => authorize
        ? { outcome: "allow" as const } : { outcome: "deny" as const, message: "Repeat denied" } } : {}),
    });
    record(name, output);
    if (approval !== "queued" || name !== "calendar_create_event" || !authorize) return output;
    const pending = queue.list("pending")[0];
    expect(pending).toBeDefined();
    const selected = queue.getExecutionSnapshot(pending.id);
    if (!selected.ok) throw new Error("Expected executable approval");
    const context = { scopeId, scopeRoot: dir, cwd: dir };
    const prepared = await prepareApprovalExecutionBatch([selected.snapshot], context);
    if (!prepared.ok) throw new Error(prepared.body.error);
    await withApprovalExecutionLeases(prepared.leases.values(), async () => {
      const lease = prepared.leases.get(pending.id)!;
      const approved = queue.approveForExecution(lease);
      if (!approved.ok) throw new Error("Approval rejected");
      const resolved = await approvedApprovalResponse(approved.approval, context, lease);
      record("operator approves queued operation", resolved);
      expect(resolved.resolution).toMatchObject({ kind: "tool_execution", execution: { output: { redacted: true } } });
    });
    expect(queue.getExecutionSnapshot(pending.id).ok).toBe(false);
    return output;
  }
  const input = meeting();
  provider.mode = "lost-committed";
  await invoke("calendar_create_event", input);
  expect(provider.posts, JSON.stringify(transcript)).toHaveLength(1);
  expect(provider.events.size).toBe(1);
  store = new IdempotencyStore(join(dir, "idempotency"), scopeId, () => new Date("2040-01-01"));
  const checked = await invoke("calendar_check_event", input);
  expect(checked[0].content).toContain("Calendar outcome: confirmed");
  await invoke("calendar_create_event", input, false);
  expect(provider.posts, JSON.stringify(transcript)).toHaveLength(1);
  await invoke("calendar_create_event", input);
  expect(provider.posts, JSON.stringify(transcript)).toHaveLength(1);

  const absent = meeting();
  provider.mode = "lost-uncommitted";
  await invoke("calendar_create_event", absent);
  expect(provider.posts).toHaveLength(2);
  expect(provider.events.size).toBe(1);
  const notFound = await invoke("calendar_check_event", absent);
  expect(notFound[0].content).toContain("Calendar outcome: absent");
  await invoke("calendar_create_event", { ...absent, summary: "Changed" });
  expect(provider.posts).toHaveLength(2);
  provider.mode = "normal";
  await invoke("calendar_create_event", absent);
  expect(provider.posts).toHaveLength(3);
  expect(provider.posts[1].body.id).toBe(provider.posts[2].body.id);
  expect(provider.events.size).toBe(2);
  await invoke("calendar_create_event", { ...input, operationId: meeting().operationId });
  expect(provider.posts).toHaveLength(4);
  expect(provider.events.size).toBe(3);
  expect(new Set(provider.posts.map((post) => post.body.id)).size).toBe(3);

  const malformed = meeting();
  provider.mode = "empty-body";
  await invoke("calendar_create_event", malformed);
  const reconciled = await invoke("calendar_check_event", malformed);
  expect(reconciled[0].content).toContain("Calendar outcome: confirmed");
  expect(provider.posts).toHaveLength(5);
  process.stdout.write(`${JSON.stringify({ journey: approval, transcript, providerRequests: provider.posts, httpTelemetry: provider.telemetry }, null, 2)}\n`);
});

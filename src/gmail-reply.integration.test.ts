import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { approvedApprovalResponse, prepareApprovalExecutionBatch, withApprovalExecutionLeases } from "#modules/approval-queue/approval-execution.js";
import { makeGmailGetMessage, makeGmailSend } from "#modules/google-workspace/gmail.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.reverse()) dispose(); cleanup.length = 0; });

// Detects lost reply identity or altered recipients across read selection, approval
// presentation and delayed execution. Only the external HTTP port is replaced.
it.each(["inline", "queued"] as const)("preserves selected Gmail reply through %s approval", async (mode) => {
  const dir = mkdtempSync(join(tmpdir(), "gmail-reply-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const scopeId = "gmail-reply-journey";
  const queue = new ApprovalQueue(join(dir, "approvals"), null, { scopeId });
  const posts: unknown[] = [];
  const transcript: Array<{ action: string; output: unknown }> = [];
  const parent = { id: "parent", threadId: "conversation", payload: {
    mimeType: "text/plain", body: { data: Buffer.from("Can you confirm Friday?").toString("base64url") },
    headers: [
      { name: "Subject", value: "Planning" }, { name: "From", value: "author@example.test" },
      { name: "Reply-To", value: "reply@example.test" }, { name: "To", value: "owner@example.test" },
      { name: "Cc", value: "not-selected@example.test" }, { name: "Message-ID", value: "<parent@example.test>" },
    ],
  } };
  const http = outboundHttpRequestPort(async (request) => {
    if (request.method === "GET") return Response.json(parent);
    const sent = JSON.parse(String(request.body));
    posts.push({ threadId: sent.threadId, mime: Buffer.from(sent.raw, "base64url").toString() });
    return Response.json({ id: "sent", threadId: "conversation" });
  });
  for (const def of [makeGmailGetMessage(async () => "synthetic-token", "me", http), makeGmailSend(async () => "synthetic-token", "me", http)]) {
    cleanup.push(registerTool(def.tool, def.runner, "google-workspace", { effect: def.effect }));
  }
  const context = { scopeId, scopeRoot: dir, cwd: dir };
  const options = { ...context, resultLimit: 8000, verbose: false, autonomyMode: "supervised" as const, approvalQueue: queue,
    guardrailsConfig: { policies: { safe: "allow" as const, moderate: "allow" as const, dangerous: "queue" as const } } };
  const read = await executeToolCalls([{ type: "tool_use", id: "read", name: "gmail_get_message", input: { id: "parent" } }], { ...options, clientApprovalResolver: async () => ({ outcome: "allow" }) });
  transcript.push({ action: "Read selected message", output: read });
  expect(read[0].content).toContain('"replyToMessageId":"parent","replyThreadId":"conversation","subject":"Planning"');
  expect(read[0].content).toContain("reply@example.test");
  const input = { replyToMessageId: "parent", replyThreadId: "conversation", subject: "Planning", to: "reply@example.test", body: "Friday confirmed." };
  const send = { type: "tool_use" as const, id: "send", name: "gmail_send", input };
  const denied = await executeToolCalls([send], { ...options, clientApprovalResolver: async () => ({ outcome: "deny", message: "Not yet" }) });
  transcript.push({ action: "Deny reply", output: denied });
  expect(posts).toHaveLength(0);
  const result = await executeToolCalls([{ ...send, id: "send-approved" }], { ...options, ...(mode === "inline" ? {
    clientApprovalResolver: async (request) => {
      expect(request.input).toEqual(input);
      transcript.push({ action: "Approve selected reply", output: request });
      return { outcome: "allow" as const };
    },
  } : {}) });
  transcript.push({ action: "Send reply", output: result });
  if (mode === "queued") {
    expect(posts).toHaveLength(0);
    const pending = queue.list("pending")[0];
    const review = queue.projectForClient(pending).review;
    transcript.push({ action: "Operator approval review", output: review });
    for (const value of Object.values(input)) expect(JSON.stringify(review)).toContain(value);
    const selected = queue.getExecutionSnapshot(pending.id);
    if (!selected.ok) throw new Error("Expected executable approval");
    const prepared = await prepareApprovalExecutionBatch([selected.snapshot], context);
    if (!prepared.ok) throw new Error(prepared.body.error);
    await withApprovalExecutionLeases(prepared.leases.values(), async () => {
      const lease = prepared.leases.get(pending.id)!;
      const approved = queue.approveForExecution(lease);
      if (!approved.ok) throw new Error("Approval rejected");
      const resolved = await approvedApprovalResponse(approved.approval, context, lease);
      transcript.push({ action: "Approved reply execution result", output: resolved });
      expect(resolved.resolution).toMatchObject({ kind: "tool_execution", execution: { output: { redacted: true } } });
    });
  } else {
    expect(result[0].content).toContain("Google accepted reply to message parent in thread conversation");
  }
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ threadId: "conversation", mime: expect.stringContaining("To: reply@example.test") });
  expect(JSON.stringify(posts)).not.toContain("not-selected");
  transcript.push({ action: "Captured provider request (controlled HTTP, no live mail)", output: posts });
  process.stdout.write(`${JSON.stringify({ mode, transcript }, null, 2)}\n`);
});

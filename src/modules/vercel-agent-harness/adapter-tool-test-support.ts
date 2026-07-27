import type {
  AgentCanUseTool,
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import {
  captureStreamTextArgs,
  createStreamTextStub,
  type StreamTextArgs,
  streamTextMock,
  type ToolExecuteFn,
  VERCEL_TEST_MODEL,
} from "./adapter-test-support.js";

export async function runAndCaptureToolExecute(opts: {
  harness: Pick<AgentHarness, "run">;
  canUseTool?: AgentCanUseTool;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  sessionContext?: AgentHarnessRunOptions["sessionContext"];
  workflowContext?: AgentHarnessRunOptions["workflowContext"];
  autonomyMode?: AgentHarnessRunOptions["autonomyMode"];
  guardrailsConfig?: AgentHarnessRunOptions["guardrailsConfig"];
  clientApprovalResolver?: AgentHarnessRunOptions["clientApprovalResolver"];
}): Promise<{
  toolExecute: ToolExecuteFn;
  streamArgs: StreamTextArgs;
}> {
  streamTextMock.mockImplementation(() => createStreamTextStub());

  await opts.harness.run({
    prompt: "go",
    model: VERCEL_TEST_MODEL,
    effort: "xhigh",
    ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
    ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
    ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.sessionContext ? { sessionContext: opts.sessionContext } : {}),
    ...(opts.workflowContext ? { workflowContext: opts.workflowContext } : {}),
    ...(opts.autonomyMode ? { autonomyMode: opts.autonomyMode } : {}),
    ...(opts.guardrailsConfig ? { guardrailsConfig: opts.guardrailsConfig } : {}),
    ...(opts.clientApprovalResolver
      ? { clientApprovalResolver: opts.clientApprovalResolver }
      : {}),
  });

  const streamArgs = captureStreamTextArgs();
  const toolExecute = streamArgs.tools?.echo_tool?.execute;
  if (!toolExecute) throw new Error("echo_tool execute was not registered");
  return { toolExecute, streamArgs };
}

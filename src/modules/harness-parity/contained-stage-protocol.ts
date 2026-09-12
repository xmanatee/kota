import { z } from "zod";
import type { AgentHarnessResult, KotaAgentMessage } from "#core/agent-harness/index.js";
import { decodeKotaMessage } from "#core/agent-harness/message-codec.js";
import { parseAgentUsage } from "#core/agent-harness/usage.js";

export const containedStageRequest = z.object({
  harness: z.string().min(1), prompt: z.string(), model: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  maxTurns: z.number().int().positive().optional(),
  modelOutputTokenLimits: z.record(z.string(), z.number().int().positive()).optional(),
  harnessOverrides: z.record(z.string(), z.unknown()).optional(),
}).strict();
const usage = z.unknown().transform((raw) => parseAgentUsage(raw, "contained stage usage"));
const resultSchema = z.object({ text: z.string(), streamedText: z.string(), turns: z.number().int().nonnegative(),
  isError: z.boolean(), usage, sessionId: z.string().optional(), subtype: z.string().optional() }).strict();
const envelope = { sessionId: z.string().optional() };
const content = z.unknown().transform((raw) => decodeKotaMessage({ role: "user", content: raw }).content);
const messageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("text"), text: z.string() }),
  z.object({ ...envelope, type: z.literal("thinking"), thinking: z.string() }),
  z.object({ ...envelope, type: z.literal("tool_call"), toolUseId: z.string(), toolName: z.string(), input: z.record(z.string(), z.unknown()) }),
  z.object({ ...envelope, type: z.literal("tool_result"), toolUseId: z.string(), isError: z.boolean(), content,
    resultContentProvenance: z.object({ kind: z.literal("external-mcp"), serverName: z.string(), source: z.enum(["tool", "operation"]), name: z.string() }).optional() }),
  z.object({ ...envelope, type: z.literal("status"), category: z.string(), description: z.string().optional(), toolName: z.string().optional(),
    text: z.string().optional(), output: z.array(z.string()).optional(), commandTrace: z.object({ algorithm: z.literal("sha256-normalized-shell-segments-v1"), exactDigests: z.array(z.string()), prefixDigests: z.array(z.string()) }).optional() }),
  z.object({ ...envelope, type: z.literal("result"), isError: z.boolean(), text: z.string().optional(), subtype: z.string().optional(), numTurns: z.number().int().nonnegative().optional(), usage }),
  z.object({ ...envelope, type: z.literal("raw"), adapter: z.string(), payload: z.record(z.string(), z.unknown()) }),
]);
export const CONTAINED_STAGE_RESULT_PREFIX = "KOTA_CONTAINED_STAGE_RESULT=";
export function decodeContainedStageOutput(stdout: string): { result: AgentHarnessResult; messages: KotaAgentMessage[] } {
  const lines = stdout.split("\n").filter((line) => line.startsWith(CONTAINED_STAGE_RESULT_PREFIX));
  if (lines.length !== 1) throw new Error("Contained stage requires exactly one terminal result");
  return z.object({ result: resultSchema, messages: z.array(messageSchema) }).strict()
    .parse(JSON.parse(lines[0]!.slice(CONTAINED_STAGE_RESULT_PREFIX.length)));
}

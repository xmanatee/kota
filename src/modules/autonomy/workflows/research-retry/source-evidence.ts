import { createHash } from "node:crypto";
import { z } from "zod";
import { redactSensitiveText } from "#core/evidence/policy.js";
import type { WorkflowRunToolRunner } from "#core/workflow/run-types.js";
import {
  classifyResourceUrl,
  type ResearchRetryCapability,
  type ResearchSourceAttempt,
  researchSourceAttemptSchema,
  researchSourceTool,
  sourceAccessFingerprint,
} from "./precondition.js";

export const sourceEvidenceSchema = z.object({
  attempts: z.array(researchSourceAttemptSchema),
  sources: z.array(z.object({
    url: z.url(),
    readings: z.array(z.object({ tool: z.enum(["web_fetch", "rendered_article_read", "x_post_read"]), content: z.string().max(16_000), isError: z.boolean() })),
  })),
});
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

const httpReadingSchema = z.object({
  url: z.url(),
  content: z.string().max(16_000),
  isError: z.boolean(),
  attemptedAt: z.iso.datetime(),
});
export const httpReadingsSchema = z.array(httpReadingSchema);
export type HttpReadings = z.infer<typeof httpReadingsSchema>;

async function readSource(url: string, tool: ResearchSourceAttempt["tools"][number], runTool: WorkflowRunToolRunner) {
  // Branching and earlier sources must never rebind a durable browser effect.
  const effectId = `research-source:${createHash("sha256").update(JSON.stringify([url, tool])).digest("hex")}`;
  const result = await runTool(tool, { url, ...(tool === "x_post_read" ? {} : { max_length: 12_000 }) }, {
    stepId: tool === "web_fetch" ? "collect-http-sources" : "collect-sources", effectId,
  });
  return { tool, content: redactSensitiveText(result.content).slice(0, 16_000), isError: result.is_error === true };
}

/** Persist this ordinary code-step output before starting any browser effects. */
export async function collectResearchHttpReadings(input: {
  urls: readonly string[];
  runTool: WorkflowRunToolRunner;
}): Promise<HttpReadings> {
  const readings: HttpReadings = [];
  for (const url of input.urls.filter((url) => classifyResourceUrl(url) === "plain-http")) {
    const reading = await readSource(url, "web_fetch", input.runTool);
    readings.push({ url, content: reading.content, isError: reading.isError, attemptedAt: new Date().toISOString() });
  }
  return readings;
}

/** The workflow owns authorized reads; native agents consume screened evidence. */
export async function collectResearchSourceEvidence(input: {
  urls: readonly string[];
  capability: ResearchRetryCapability;
  httpReadings: HttpReadings;
  runTool: WorkflowRunToolRunner;
}): Promise<SourceEvidence> {
  const evidence: SourceEvidence = { attempts: [], sources: [] };
  for (const url of input.urls) {
    const kind = classifyResourceUrl(url);
    const readings: SourceEvidence["sources"][number]["readings"] = [];
    const http = input.httpReadings.find((reading) => reading.url === url);
    if (kind === "plain-http") {
      if (!http) throw new Error(`Missing retained HTTP reading for ${url}`);
      readings.push({ tool: "web_fetch", content: http.content, isError: http.isError });
    } else {
      readings.push(await readSource(url, researchSourceTool(url), input.runTool));
    }
    if (kind === "plain-http" && input.capability.playwrightAvailable &&
      input.capability.availableTools.includes("rendered_article_read") &&
      /(?:requires?|enable) javascript|client.side render|no readable content/i.test(readings[0]!.content)) {
      readings.push(await readSource(url, "rendered_article_read", input.runTool));
    }
    const result = readings.at(-1)!;
    const tools = readings.map((reading) => reading.tool);
    evidence.sources.push({ url, readings });
    evidence.attempts.push({
      url,
      tools,
      accessFingerprint: sourceAccessFingerprint(url, input.capability, tools),
      attemptedAt: readings.length === 1 && http ? http.attemptedAt : new Date().toISOString(),
      outcome: !result.isError && result.content.trim() ? "readable" : "unavailable",
    });
  }
  return evidence;
}

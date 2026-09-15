import { z } from "zod";
import type { WorkflowRunToolRunner } from "#core/workflow/run-types.js";
import {
  classifyResourceUrl,
  type ResearchRetryCapability,
  type ResearchSourceAttempt,
  researchSourceAttemptSchema,
  sourceAccessFingerprint,
} from "./precondition.js";

export const sourceEvidenceSchema = z.object({
  attempts: z.array(researchSourceAttemptSchema),
  sources: z.array(z.object({
    url: z.url(),
    readings: z.array(z.object({ tool: z.string(), content: z.string(), isError: z.boolean() })),
  })),
});
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

/** The workflow owns authorized reads; native agents consume screened evidence. */
export async function collectResearchSourceEvidence(input: {
  urls: readonly string[];
  capability: ResearchRetryCapability;
  runTool: WorkflowRunToolRunner;
}): Promise<SourceEvidence> {
  const evidence: SourceEvidence = { attempts: [], sources: [] };
  for (const url of input.urls) {
    const kind = classifyResourceUrl(url);
    const tools: ResearchSourceAttempt["tools"] = [];
    const readings: SourceEvidence["sources"][number]["readings"] = [];
    const read = async (tool: ResearchSourceAttempt["tools"][number]) => {
      // Policy and cancellation exceptions remain workflow failures, not access evidence.
      const result = await input.runTool(tool, { url, ...(tool === "x_post_read" ? {} : { max_length: 12_000 }) });
      tools.push(tool);
      readings.push({ tool, content: result.content, isError: result.is_error === true });
      return result;
    };
    let result = await read(kind === "x-post" ? "x_post_read" : kind === "js-rendered" ? "rendered_article_read" : "web_fetch");
    if (kind === "plain-http" && input.capability.playwrightAvailable &&
      /(?:requires?|enable) javascript|client.side render|no readable content/i.test(result.content)) {
      result = await read("rendered_article_read");
    }
    evidence.sources.push({ url, readings });
    evidence.attempts.push({
      url,
      tools,
      accessFingerprint: sourceAccessFingerprint(url, input.capability, tools),
      attemptedAt: new Date().toISOString(),
      outcome: !result.is_error && result.content.trim() ? "readable" : "unavailable",
    });
  }
  return evidence;
}

import {
  detectInjection,
  type InjectionVerdict,
} from "#core/util/injection-detector.js";

const MIN_MARKDOWN_FENCE_LENGTH = 3;

export type RenderedUntrustedContent = {
  lines: string[];
  verdict: InjectionVerdict;
};

function maxBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function markdownFenceForContent(value: string): string {
  return "`".repeat(
    Math.max(MIN_MARKDOWN_FENCE_LENGTH, maxBacktickRun(value) + 1),
  );
}

function escapeUntrustedBlockText(value: string): string {
  return value.replace(/[<>&]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    return "\\u0026";
  });
}

function escapeSourceAttribute(value: string): string {
  return value.replace(/[<>&"]/g, (char) => {
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === "&") return "&amp;";
    return "&quot;";
  });
}

/**
 * Screen and render one untrusted prompt fragment without allowing its text to
 * close the wrapper or its Markdown fence.
 */
export function renderUntrustedContent(input: {
  source: string;
  content: string;
  language?: "json" | "text";
}): RenderedUntrustedContent {
  const verdict = detectInjection(input.content);
  const rendered = escapeUntrustedBlockText(input.content);
  const fence = markdownFenceForContent(rendered);
  const screening = JSON.stringify({
    suspicious: verdict.suspicious,
    reasons: verdict.reasons,
  });
  return {
    verdict,
    lines: [
      `Injection screening: ${screening}`,
      `<untrusted-content source="${escapeSourceAttribute(input.source)}">`,
      `${fence}${input.language ?? ""}`,
      rendered,
      fence,
      "</untrusted-content>",
    ],
  };
}

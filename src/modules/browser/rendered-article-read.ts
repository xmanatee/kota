import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunner, ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { getPage } from "./lifecycle.js";
import {
  normalizeNonNegativeInteger,
  normalizePositiveNumber,
} from "./tool-input.js";

const DEFAULT_ARTICLE_TIMEOUT_MS = 30_000;
const DEFAULT_ARTICLE_MAX_LENGTH = 40_000;

export const renderedArticleReadTool: KotaTool = {
  name: "rendered_article_read",
  description:
    "Fetch a JS-rendered article page via the configured browser and return " +
    "its readable body text. Designed for Cloudflare/JS-gated pages such as " +
    "openai.com/index/* that reject plain HTTP fetches. Navigates, waits for " +
    "DOM content plus a readable page container, prefers an <article>/main-content selector, and " +
    "falls back to document body text. Returns a typed failure when the page " +
    "is inaccessible, timed out, or still gated after JS render.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL of the article to render",
      },
      selector: {
        type: "string",
        description:
          "Optional CSS selector to scope extraction (default: prefer <article>, <main>, then body)",
      },
      timeout: {
        type: "number",
        description: `Navigation + render timeout in milliseconds (default: ${DEFAULT_ARTICLE_TIMEOUT_MS})`,
      },
      max_length: {
        type: "number",
        description: `Maximum returned text length in characters (default: ${DEFAULT_ARTICLE_MAX_LENGTH})`,
      },
    },
    required: ["url"],
  },
};

export async function runRenderedArticleRead(
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const url = typeof input.url === "string" ? input.url : "";
  if (!url) return { content: "Error: url is required", is_error: true };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      content: "Error: url must start with http:// or https://",
      is_error: true,
    };
  }
  const timeout = normalizePositiveNumber(
    input.timeout,
    DEFAULT_ARTICLE_TIMEOUT_MS,
  );
  const maxLength =
    normalizeNonNegativeInteger(input.max_length, DEFAULT_ARTICLE_MAX_LENGTH) ||
    DEFAULT_ARTICLE_MAX_LENGTH;
  const selectorHint =
    typeof input.selector === "string" && input.selector.length > 0
      ? input.selector
      : null;
  try {
    const page = await getPage(context);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    const finalUrl = page.url();
    const readySelector =
      selectorHint ?? 'article, main, [role="main"], body';
    await page.waitForSelector(readySelector, { timeout });
    const title = await page.title();
    const gateReason = await detectRenderedGate(page, finalUrl, title);
    if (gateReason) {
      return {
        content:
          `Unable to render article at ${finalUrl}: ${gateReason}. The page may ` +
          "require an authenticated browser profile or be inaccessible to automation.",
        is_error: true,
      };
    }
    const extract = (await page.evaluate(
      buildArticleExtractScript(selectorHint),
    )) as {
      text: string;
      usedSelector: string;
    };
    const text = (extract.text ?? "").trim();
    if (!text) {
      return {
        content: `Rendered page at ${finalUrl} produced no readable text.`,
        is_error: true,
      };
    }
    const header = `URL: ${finalUrl}\nTitle: ${title}\nExtracted via: ${extract.usedSelector}\n\n`;
    if (text.length > maxLength) {
      return {
        content:
          header +
          text.slice(0, maxLength) +
          `\n\n[Truncated — ${text.length} chars total, showing first ${maxLength}]`,
      };
    }
    return { content: header + text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason =
      msg.includes("timeout") || msg.includes("Timeout")
        ? `rendered_article_read timeout after ${timeout}ms: ${msg}`
        : `rendered_article_read error: ${msg}`;
    return { content: reason, is_error: true };
  }
}

async function detectRenderedGate(
  page: Awaited<ReturnType<typeof getPage>>,
  finalUrl: string,
  title: string,
): Promise<string | null> {
  if (/Just a moment/i.test(title) || /__cf_chl_/i.test(finalUrl)) {
    return "page is still behind a JS / Cloudflare challenge after render";
  }
  const probe = (await page.evaluate(
    "document.body ? document.body.innerText.slice(0, 1500) : ''",
  )) as string;
  if (/Just a moment\.\.\.|Checking your browser|Enable JavaScript/i.test(probe)) {
    return "page is still behind a JS / Cloudflare challenge after render";
  }
  if (
    /Access Denied|403 Forbidden|Not Found/i.test(probe) &&
    probe.length < 400
  ) {
    return "page returned an access denial";
  }
  return null;
}

function buildArticleExtractScript(selector: string | null): string {
  if (selector) {
    return `
(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { text: '', usedSelector: ${JSON.stringify(selector)} };
  return { text: el.innerText || '', usedSelector: ${JSON.stringify(selector)} };
})()
`;
  }
  return `
(() => {
  const candidates = ['article', 'main', '[role="main"]'];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) {
      return { text: el.innerText, usedSelector: sel };
    }
  }
  return { text: document.body ? document.body.innerText : '', usedSelector: 'body' };
})()
`;
}

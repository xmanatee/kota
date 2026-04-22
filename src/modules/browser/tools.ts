import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "#core/tools/tool-result.js";
import { closeBrowser, getPage } from "./lifecycle.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SCREENSHOT_WIDTH = 1280;
const DEFAULT_MAX_SCREENSHOT_HEIGHT = 720;

export const browserNavigateTool: Anthropic.Tool = {
  name: "browser_navigate",
  description:
    "Navigate to a URL in a headless browser. Waits for the page to reach network idle " +
    "or for an optional CSS selector to appear. Returns the page title and URL after navigation.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The URL to navigate to",
      },
      wait_for: {
        type: "string",
        description:
          "Optional CSS selector to wait for after navigation (default: wait for network idle)",
      },
      timeout: {
        type: "number",
        description: `Navigation timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
      },
    },
    required: ["url"],
  },
};

export async function runBrowserNavigate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = input.url as string;
  if (!url) {
    return { content: "Error: url is required", is_error: true };
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      content: "Error: url must start with http:// or https://",
      is_error: true,
    };
  }
  const timeout = (input.timeout as number) || DEFAULT_TIMEOUT_MS;
  try {
    const page = await getPage();
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout,
    });
    if (input.wait_for) {
      await page.waitForSelector(input.wait_for as string, { timeout });
    }
    const title = await page.title();
    const finalUrl = page.url();
    return {
      content: `Navigated to: ${finalUrl}\nTitle: ${title}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Navigation error: ${msg}`, is_error: true };
  }
}

export const browserClickTool: Anthropic.Tool = {
  name: "browser_click",
  description:
    "Click an element on the current page by CSS selector. " +
    "Waits for the element to be visible before clicking.",
  input_schema: {
    type: "object" as const,
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to click",
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds to wait for element (default: ${DEFAULT_TIMEOUT_MS})`,
      },
    },
    required: ["selector"],
  },
};

export async function runBrowserClick(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const selector = input.selector as string;
  if (!selector) {
    return { content: "Error: selector is required", is_error: true };
  }
  const timeout = (input.timeout as number) || DEFAULT_TIMEOUT_MS;
  try {
    const page = await getPage();
    await page.click(selector, { timeout });
    return { content: `Clicked: ${selector}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Click error: ${msg}`, is_error: true };
  }
}

export const browserTypeTool: Anthropic.Tool = {
  name: "browser_type",
  description:
    "Type text into an input element on the current page by CSS selector. " +
    "Optionally clears the field first.",
  input_schema: {
    type: "object" as const,
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the input element",
      },
      text: {
        type: "string",
        description: "Text to type into the element",
      },
      clear: {
        type: "boolean",
        description: "Clear the field before typing (default: false)",
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds to wait for element (default: ${DEFAULT_TIMEOUT_MS})`,
      },
    },
    required: ["selector", "text"],
  },
};

export async function runBrowserType(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const selector = input.selector as string;
  const text = input.text as string;
  if (!selector || text === undefined) {
    return {
      content: "Error: selector and text are required",
      is_error: true,
    };
  }
  const timeout = (input.timeout as number) || DEFAULT_TIMEOUT_MS;
  try {
    const page = await getPage();
    if (input.clear) {
      await page.fill(selector, "", { timeout });
    }
    await page.fill(selector, text, { timeout });
    return { content: `Typed into ${selector}: "${text}"` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Type error: ${msg}`, is_error: true };
  }
}

export const browserScreenshotTool: Anthropic.Tool = {
  name: "browser_screenshot",
  description:
    "Capture a screenshot of the current page or a specific element. " +
    "Returns the screenshot as a base64-encoded PNG image. " +
    "Respects configurable max dimensions to avoid flooding agent context.",
  input_schema: {
    type: "object" as const,
    properties: {
      selector: {
        type: "string",
        description:
          "Optional CSS selector to screenshot a specific element (default: full page viewport)",
      },
      full_page: {
        type: "boolean",
        description: "Capture the full scrollable page (default: false, captures viewport only)",
      },
      max_width: {
        type: "number",
        description: `Maximum screenshot width in pixels (default: ${DEFAULT_MAX_SCREENSHOT_WIDTH})`,
      },
      max_height: {
        type: "number",
        description: `Maximum screenshot height in pixels (default: ${DEFAULT_MAX_SCREENSHOT_HEIGHT})`,
      },
    },
    required: [],
  },
};

export async function runBrowserScreenshot(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const maxWidth = (input.max_width as number) || DEFAULT_MAX_SCREENSHOT_WIDTH;
  const maxHeight =
    (input.max_height as number) || DEFAULT_MAX_SCREENSHOT_HEIGHT;
  try {
    const page = await getPage();
    await page.setViewportSize({
      width: maxWidth,
      height: maxHeight,
    });

    let buffer: Buffer;
    if (input.selector) {
      const element = await page.waitForSelector(input.selector as string, {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      if (!element) {
        return {
          content: `Element not found: ${input.selector}`,
          is_error: true,
        };
      }
      buffer = await element.screenshot({ type: "png" });
    } else {
      buffer = await page.screenshot({
        type: "png",
        fullPage: !!input.full_page,
      });
    }

    const base64 = buffer.toString("base64");
    const sizeKB = (buffer.byteLength / 1024).toFixed(1);

    return {
      content: `Screenshot captured (${sizeKB} KB, ${maxWidth}x${maxHeight} viewport)`,
      blocks: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: base64,
          },
        },
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Screenshot error: ${msg}`, is_error: true };
  }
}

export const browserEvaluateTool: Anthropic.Tool = {
  name: "browser_evaluate",
  description:
    "Execute a JavaScript expression in the current page context and return the result. " +
    "The expression is evaluated via page.evaluate() — it runs in the browser, not in Node.",
  input_schema: {
    type: "object" as const,
    properties: {
      expression: {
        type: "string",
        description: "JavaScript expression to evaluate in the page context",
      },
    },
    required: ["expression"],
  },
};

export async function runBrowserEvaluate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const expression = input.expression as string;
  if (!expression) {
    return { content: "Error: expression is required", is_error: true };
  }
  try {
    const page = await getPage();
    const result = await page.evaluate(expression);
    const serialized =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const text = serialized ?? "undefined";
    if (text.length > 20_000) {
      return {
        content:
          text.slice(0, 20_000) +
          `\n\n[Truncated — ${text.length} chars total, showing first 20000]`,
      };
    }
    return { content: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Evaluate error: ${msg}`, is_error: true };
  }
}

export const browserGetTextTool: Anthropic.Tool = {
  name: "browser_get_text",
  description:
    "Extract visible text content from the current page or a specific element. " +
    "Returns the innerText of the target.",
  input_schema: {
    type: "object" as const,
    properties: {
      selector: {
        type: "string",
        description:
          "Optional CSS selector to extract text from (default: document.body)",
      },
      max_length: {
        type: "number",
        description: "Maximum text length in characters (default: 20000)",
      },
    },
    required: [],
  },
};

export async function runBrowserGetText(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const maxLength = Math.max(1, (input.max_length as number) || 20_000);
  try {
    const page = await getPage();
    let text: string;
    if (input.selector) {
      const element = await page.waitForSelector(input.selector as string, {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      if (!element) {
        return {
          content: `Element not found: ${input.selector}`,
          is_error: true,
        };
      }
      text = (await element.innerText()) ?? "";
    } else {
      text = (await page.evaluate("document.body.innerText")) as string;
    }
    if (!text) {
      return { content: "(no visible text)" };
    }
    if (text.length > maxLength) {
      return {
        content:
          text.slice(0, maxLength) +
          `\n\n[Truncated — ${text.length} chars total, showing first ${maxLength}]`,
      };
    }
    return { content: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Get text error: ${msg}`, is_error: true };
  }
}

export const browserCloseTool: Anthropic.Tool = {
  name: "browser_close",
  description: "Close the browser instance and release resources.",
  input_schema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export async function runBrowserClose(): Promise<ToolResult> {
  try {
    await closeBrowser();
    return { content: "Browser closed." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Close error: ${msg}`, is_error: true };
  }
}

const X_POST_URL_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i;
const DEFAULT_X_POST_TIMEOUT_MS = 20_000;
const DEFAULT_X_POST_REPLY_COUNT = 5;

export const xPostReadTool: Anthropic.Tool = {
  name: "x_post_read",
  description:
    "Read an X (Twitter) post and its immediate reply thread. Navigates a " +
    "headless browser to the post URL, waits for the tweet article to render, " +
    "and extracts the post body plus up to max_replies reply texts. Requires " +
    "an authenticated browser profile for posts behind the X auth wall — " +
    "operators configure the profile via modules.browser.storageStatePath. " +
    "Returns a typed failure when the post is auth-walled, rate-limited, " +
    "or unreachable.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "Fully-qualified X/Twitter status URL (e.g. https://x.com/user/status/1234567890)",
      },
      max_replies: {
        type: "number",
        description: `Maximum reply count to include in the thread (default: ${DEFAULT_X_POST_REPLY_COUNT})`,
      },
      timeout: {
        type: "number",
        description: `Navigation and wait timeout in milliseconds (default: ${DEFAULT_X_POST_TIMEOUT_MS})`,
      },
    },
    required: ["url"],
  },
};

export async function runXPostRead(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = typeof input.url === "string" ? input.url : "";
  if (!url) return { content: "Error: url is required", is_error: true };
  if (!X_POST_URL_RE.test(url)) {
    return {
      content:
        "Error: url must be a fully-qualified X/Twitter status URL (https://x.com/<user>/status/<id>)",
      is_error: true,
    };
  }
  const timeout = normalizeTimeout(input.timeout, DEFAULT_X_POST_TIMEOUT_MS);
  const maxReplies = normalizeCount(input.max_replies, DEFAULT_X_POST_REPLY_COUNT);
  try {
    const page = await getPage();
    await page.goto(url, { waitUntil: "networkidle", timeout });
    const finalUrl = page.url();
    const authGateReason = await detectXAuthGate(page, finalUrl);
    if (authGateReason) {
      return {
        content:
          `Unable to read X post: ${authGateReason}. Configure an authenticated ` +
          "browser profile via modules.browser.storageStatePath and retry.",
        is_error: true,
      };
    }
    const rendered = (await page.evaluate(X_POST_EXTRACT_SCRIPT)) as {
      body: string | null;
      author: string | null;
      replies: string[];
    };
    if (!rendered.body) {
      return {
        content: "Unable to extract post body — the page did not render a tweet article.",
        is_error: true,
      };
    }
    const replyLines = rendered.replies.slice(0, maxReplies).map(
      (reply, idx) => `Reply ${idx + 1}: ${reply}`,
    );
    const header = rendered.author ? `Author: ${rendered.author}\n` : "";
    const body = `${header}URL: ${finalUrl}\n\nPost:\n${rendered.body}`;
    const thread = replyLines.length > 0 ? `\n\nThread:\n${replyLines.join("\n\n")}` : "";
    return { content: `${body}${thread}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = msg.includes("timeout") || msg.includes("Timeout")
      ? `x_post_read timeout after ${timeout}ms: ${msg}`
      : `x_post_read error: ${msg}`;
    return { content: reason, is_error: true };
  }
}

function normalizeTimeout(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return fallback;
}

function normalizeCount(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return fallback;
}

async function detectXAuthGate(
  page: { url(): string; evaluate(expression: string): Promise<unknown> },
  finalUrl: string,
): Promise<string | null> {
  if (/\/(login|i\/flow\/login|account\/access)(\?|$|\/)/.test(finalUrl)) {
    return "redirected to X login — session is not authenticated";
  }
  const bodyText = (await page.evaluate(
    "document.body ? document.body.innerText.slice(0, 2000) : ''",
  )) as string;
  if (/Log in to (?:X|Twitter)|Sign up|Something went wrong/i.test(bodyText)) {
    return "X displayed an auth-wall / login prompt in place of the post";
  }
  if (/Rate limit exceeded|too many requests/i.test(bodyText)) {
    return "X is rate-limiting the session";
  }
  return null;
}

const X_POST_EXTRACT_SCRIPT = `
(() => {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  if (articles.length === 0) return { body: null, author: null, replies: [] };
  const first = articles[0];
  const textEl = first.querySelector('[data-testid="tweetText"]');
  const body = textEl ? textEl.textContent.trim() : null;
  const userEl = first.querySelector('[data-testid="User-Name"]');
  const author = userEl ? userEl.textContent.trim() : null;
  const replies = [];
  for (let i = 1; i < articles.length && replies.length < 20; i += 1) {
    const reply = articles[i].querySelector('[data-testid="tweetText"]');
    if (reply && reply.textContent.trim()) {
      replies.push(reply.textContent.trim());
    }
  }
  return { body, author, replies };
})()
`;

const DEFAULT_ARTICLE_TIMEOUT_MS = 30_000;
const DEFAULT_ARTICLE_MAX_LENGTH = 40_000;

export const renderedArticleReadTool: Anthropic.Tool = {
  name: "rendered_article_read",
  description:
    "Fetch a JS-rendered article page via the headless browser and return " +
    "its readable body text. Designed for Cloudflare/JS-gated pages such as " +
    "openai.com/index/* that reject plain HTTP fetches. Navigates, waits for " +
    "network idle, prefers a readable <article>/main-content selector, and " +
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
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = typeof input.url === "string" ? input.url : "";
  if (!url) return { content: "Error: url is required", is_error: true };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      content: "Error: url must start with http:// or https://",
      is_error: true,
    };
  }
  const timeout = normalizeTimeout(input.timeout, DEFAULT_ARTICLE_TIMEOUT_MS);
  const maxLength = normalizeCount(input.max_length, DEFAULT_ARTICLE_MAX_LENGTH) || DEFAULT_ARTICLE_MAX_LENGTH;
  const selectorHint = typeof input.selector === "string" && input.selector.length > 0
    ? (input.selector as string)
    : null;
  try {
    const page = await getPage();
    await page.goto(url, { waitUntil: "networkidle", timeout });
    const finalUrl = page.url();
    const title = await page.title();
    const gateReason = await detectRenderedGate(page);
    if (gateReason) {
      return {
        content:
          `Unable to render article at ${finalUrl}: ${gateReason}. The page may ` +
          "require an authenticated browser profile or be inaccessible to automation.",
        is_error: true,
      };
    }
    const extract = (await page.evaluate(buildArticleExtractScript(selectorHint))) as {
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
    const reason = msg.includes("timeout") || msg.includes("Timeout")
      ? `rendered_article_read timeout after ${timeout}ms: ${msg}`
      : `rendered_article_read error: ${msg}`;
    return { content: reason, is_error: true };
  }
}

async function detectRenderedGate(page: {
  evaluate(expression: string): Promise<unknown>;
}): Promise<string | null> {
  const probe = (await page.evaluate(
    "document.body ? document.body.innerText.slice(0, 1500) : ''",
  )) as string;
  if (/Just a moment\.\.\.|Checking your browser|Enable JavaScript/i.test(probe)) {
    return "page is still behind a JS / Cloudflare challenge after network idle";
  }
  if (/Access Denied|403 Forbidden|Not Found/i.test(probe) && probe.length < 400) {
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

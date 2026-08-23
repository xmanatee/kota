import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunner, ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { getPage } from "./lifecycle.js";
import {
  normalizeNonNegativeInteger,
  normalizePositiveNumber,
} from "./tool-input.js";

const X_POST_URL_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i;
const DEFAULT_X_POST_TIMEOUT_MS = 20_000;
const DEFAULT_X_POST_REPLY_COUNT = 5;

export const xPostReadTool: KotaTool = {
  name: "x_post_read",
  description:
    "Read an X (Twitter) post and its immediate reply thread. Navigates a " +
    "browser to the post URL, waits for DOM content and the tweet article to render, " +
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
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
  const timeout = normalizePositiveNumber(
    input.timeout,
    DEFAULT_X_POST_TIMEOUT_MS,
  );
  const maxReplies = normalizeNonNegativeInteger(
    input.max_replies,
    DEFAULT_X_POST_REPLY_COUNT,
  );
  try {
    const page = await getPage(context);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
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
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout });
    } catch (err) {
      const afterWaitGateReason = await detectXAuthGate(page, page.url());
      if (afterWaitGateReason) {
        return {
          content:
            `Unable to read X post: ${afterWaitGateReason}. Configure an authenticated ` +
            "browser profile via modules.browser.storageStatePath and retry.",
          is_error: true,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: `x_post_read timeout after ${timeout}ms waiting for tweet article: ${msg}`,
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
        content:
          "Unable to extract post body — the page did not render a tweet article.",
        is_error: true,
      };
    }
    const replyLines = rendered.replies
      .slice(0, maxReplies)
      .map((reply, idx) => `Reply ${idx + 1}: ${reply}`);
    const header = rendered.author ? `Author: ${rendered.author}\n` : "";
    const body = `${header}URL: ${finalUrl}\n\nPost:\n${rendered.body}`;
    const thread =
      replyLines.length > 0 ? `\n\nThread:\n${replyLines.join("\n\n")}` : "";
    return { content: `${body}${thread}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason =
      msg.includes("timeout") || msg.includes("Timeout")
        ? `x_post_read timeout after ${timeout}ms: ${msg}`
        : `x_post_read error: ${msg}`;
    return { content: reason, is_error: true };
  }
}

async function detectXAuthGate(
  page: Awaited<ReturnType<typeof getPage>>,
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
  function cleanArticleText(text) {
    return String(text || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(Subscribe|Follow|Conversation|Article|See new posts|Translate post|Show more|Home|Explore|Notifications|Messages|Bookmarks|Premium|Profile|More|Post)$/.test(line))
      .join('\\n')
      .trim();
  }
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  if (articles.length === 0) return { body: null, author: null, replies: [] };
  const first = articles[0];
  const textEl = first.querySelector('[data-testid="tweetText"]');
  const body = textEl ? textEl.textContent.trim() : cleanArticleText(first.innerText);
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

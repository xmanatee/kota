import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunner, ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { closeBrowserSession, getPage } from "./lifecycle.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SCREENSHOT_WIDTH = 1280;
const DEFAULT_MAX_SCREENSHOT_HEIGHT = 720;

export const browserScreenshotTool: KotaTool = {
  name: "browser_screenshot",
  description:
    "Capture a screenshot of the current page or a specific element. " +
    "Returns the screenshot as a base64-encoded PNG image. " +
    "Respects configurable max dimensions to avoid flooding agent context. " +
    "This is not a native desktop coordinate map for computer_use; use browser selectors for browser actions.",
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
        description:
          "Capture the full scrollable page (default: false, captures viewport only)",
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const maxWidth = (input.max_width as number) || DEFAULT_MAX_SCREENSHOT_WIDTH;
  const maxHeight =
    (input.max_height as number) || DEFAULT_MAX_SCREENSHOT_HEIGHT;
  try {
    const page = await getPage(context);
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
      content: `Screenshot captured (${sizeKB} KB, ${maxWidth}x${maxHeight} viewport). Not a native desktop coordinate map for computer_use; use browser selectors for browser actions.`,
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

export const browserEvaluateTool: KotaTool = {
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const expression = input.expression as string;
  if (!expression) {
    return { content: "Error: expression is required", is_error: true };
  }
  try {
    const page = await getPage(context);
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

export const browserGetTextTool: KotaTool = {
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const maxLength = Math.max(1, (input.max_length as number) || 20_000);
  try {
    const page = await getPage(context);
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

export const browserCloseTool: KotaTool = {
  name: "browser_close",
  description:
    "Close this session's browser context and release its resources.",
  input_schema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export async function runBrowserClose(
  _input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  try {
    await closeBrowserSession(context);
    return { content: "Browser closed." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Close error: ${msg}`, is_error: true };
  }
}

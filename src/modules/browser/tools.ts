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

import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunner, ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { getPage } from "./lifecycle.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export const browserNavigateTool: KotaTool = {
  name: "browser_navigate",
  description:
    "Navigate to a URL in the configured browser. Waits for the page to reach network idle " +
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
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
    const page = await getPage(context);
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

export const browserClickTool: KotaTool = {
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const selector = input.selector as string;
  if (!selector) {
    return { content: "Error: selector is required", is_error: true };
  }
  const timeout = (input.timeout as number) || DEFAULT_TIMEOUT_MS;
  try {
    const page = await getPage(context);
    await page.click(selector, { timeout });
    return { content: `Clicked: ${selector}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Click error: ${msg}`, is_error: true };
  }
}

export const browserTypeTool: KotaTool = {
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
  input: Parameters<ToolRunner>[0],
  context?: ToolRunnerContext,
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
    const page = await getPage(context);
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModule } from "#core/modules/module-types.js";

vi.mock("./lifecycle.js", () => ({
  isPlaywrightAvailable: vi.fn(() => true),
  closeBrowser: vi.fn(async () => {}),
  getPage: vi.fn(),
}));

const { getPage, closeBrowser, isPlaywrightAvailable } = await import(
  "./lifecycle.js"
);

describe("browser module", () => {
  let mod: KotaModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = (await import("./index.js")).default;
  });

  it("has correct metadata", () => {
    expect(mod.name).toBe("browser");
    expect(mod.version).toBe("1.0.0");
    expect(mod.description).toBeTruthy();
  });

  it("contributes expected tools", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const names = tools.map((t) => t.tool.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_evaluate");
    expect(names).toContain("browser_get_text");
    expect(names).toContain("browser_close");
  });

  it("classifies interactive tools as dangerous", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const interactive = tools.filter(
      (t) => t.tool.name !== "browser_close",
    );
    for (const t of interactive) {
      expect(t.risk).toBe("dangerous");
    }
  });

  it("classifies browser_close as safe", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const close = tools.find((t) => t.tool.name === "browser_close");
    expect(close?.risk).toBe("safe");
  });

  it("puts all tools in the browser group", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    for (const t of tools) {
      expect(t.group).toBe("browser");
    }
  });

  it("logs warning when playwright is not installed", () => {
    vi.mocked(isPlaywrightAvailable).mockReturnValue(false);
    const warn = vi.fn();
    const ctx = {
      log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      registerCleanupHook: vi.fn(),
    } as never;
    mod.onLoad?.(ctx);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Playwright is not installed"),
    );
  });

  it("does not warn when playwright is installed", () => {
    vi.mocked(isPlaywrightAvailable).mockReturnValue(true);
    const warn = vi.fn();
    const ctx = {
      log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      registerCleanupHook: vi.fn(),
    } as never;
    mod.onLoad?.(ctx);
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers cleanup hook on load", () => {
    const registerCleanupHook = vi.fn();
    const ctx = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerCleanupHook,
    } as never;
    mod.onLoad?.(ctx);
    expect(registerCleanupHook).toHaveBeenCalledWith(expect.any(Function));
  });

  it("closes browser on unload", async () => {
    await mod.onUnload?.();
    expect(closeBrowser).toHaveBeenCalled();
  });
});

describe("browser tool schemas", () => {
  let mod: KotaModule;

  beforeEach(async () => {
    mod = (await import("./index.js")).default;
  });

  it("browser_navigate requires url", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const nav = tools.find((t) => t.tool.name === "browser_navigate");
    expect(nav?.tool.input_schema.required).toContain("url");
  });

  it("browser_click requires selector", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const click = tools.find((t) => t.tool.name === "browser_click");
    expect(click?.tool.input_schema.required).toContain("selector");
  });

  it("browser_type requires selector and text", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const type = tools.find((t) => t.tool.name === "browser_type");
    expect(type?.tool.input_schema.required).toContain("selector");
    expect(type?.tool.input_schema.required).toContain("text");
  });

  it("browser_evaluate requires expression", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const evaluate = tools.find((t) => t.tool.name === "browser_evaluate");
    expect(evaluate?.tool.input_schema.required).toContain("expression");
  });

  it("all tools have valid input_schema with type object", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    for (const t of tools) {
      expect(t.tool.input_schema.type).toBe("object");
      expect(t.tool.input_schema.properties).toBeDefined();
    }
  });
});

describe("browser tool runners", () => {
  let mockPage: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({
        screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
        innerText: vi.fn().mockResolvedValue("element text"),
      }),
      title: vi.fn().mockResolvedValue("Test Page"),
      url: vi.fn().mockReturnValue("https://example.com/test"),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ key: "value" }),
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
      isClosed: vi.fn().mockReturnValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getPage).mockResolvedValue(mockPage as never);
  });

  describe("browser_navigate", () => {
    it("returns error for missing url", async () => {
      const { runBrowserNavigate } = await import("./tools.js");
      const result = await runBrowserNavigate({});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("url is required");
    });

    it("returns error for invalid protocol", async () => {
      const { runBrowserNavigate } = await import("./tools.js");
      const result = await runBrowserNavigate({ url: "ftp://example.com" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("http://");
    });

    it("navigates and returns title and url", async () => {
      const { runBrowserNavigate } = await import("./tools.js");
      const result = await runBrowserNavigate({
        url: "https://example.com",
      });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("https://example.com/test");
      expect(result.content).toContain("Test Page");
      expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
    });

    it("waits for optional selector", async () => {
      const { runBrowserNavigate } = await import("./tools.js");
      await runBrowserNavigate({
        url: "https://example.com",
        wait_for: "#main",
      });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith("#main", {
        timeout: 30_000,
      });
    });

    it("handles navigation errors", async () => {
      mockPage.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const { runBrowserNavigate } = await import("./tools.js");
      const result = await runBrowserNavigate({
        url: "https://example.com",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("ERR_CONNECTION_REFUSED");
    });
  });

  describe("browser_click", () => {
    it("returns error for missing selector", async () => {
      const { runBrowserClick } = await import("./tools.js");
      const result = await runBrowserClick({});
      expect(result.is_error).toBe(true);
    });

    it("clicks the element", async () => {
      const { runBrowserClick } = await import("./tools.js");
      const result = await runBrowserClick({ selector: "button.submit" });
      expect(result.content).toContain("Clicked: button.submit");
      expect(mockPage.click).toHaveBeenCalledWith("button.submit", {
        timeout: 30_000,
      });
    });
  });

  describe("browser_type", () => {
    it("returns error for missing fields", async () => {
      const { runBrowserType } = await import("./tools.js");
      const result = await runBrowserType({});
      expect(result.is_error).toBe(true);
    });

    it("types text into input", async () => {
      const { runBrowserType } = await import("./tools.js");
      const result = await runBrowserType({
        selector: "input#name",
        text: "Alice",
      });
      expect(result.content).toContain('Typed into input#name: "Alice"');
      expect(mockPage.fill).toHaveBeenCalledWith("input#name", "Alice", {
        timeout: 30_000,
      });
    });

    it("clears field before typing when clear=true", async () => {
      const { runBrowserType } = await import("./tools.js");
      await runBrowserType({
        selector: "input#name",
        text: "Bob",
        clear: true,
      });
      expect(mockPage.fill).toHaveBeenCalledTimes(2);
      expect(mockPage.fill).toHaveBeenCalledWith("input#name", "", {
        timeout: 30_000,
      });
    });
  });

  describe("browser_screenshot", () => {
    it("captures viewport screenshot with image block", async () => {
      const { runBrowserScreenshot } = await import("./tools.js");
      const result = await runBrowserScreenshot({});
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Screenshot captured");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks![0].type).toBe("image");
    });

    it("captures element screenshot by selector", async () => {
      const { runBrowserScreenshot } = await import("./tools.js");
      const result = await runBrowserScreenshot({ selector: "#chart" });
      expect(result.is_error).toBeUndefined();
      expect(mockPage.waitForSelector).toHaveBeenCalledWith("#chart", {
        timeout: 30_000,
      });
    });

    it("sets viewport to max dimensions", async () => {
      const { runBrowserScreenshot } = await import("./tools.js");
      await runBrowserScreenshot({ max_width: 800, max_height: 600 });
      expect(mockPage.setViewportSize).toHaveBeenCalledWith({
        width: 800,
        height: 600,
      });
    });

    it("returns error when element not found", async () => {
      mockPage.waitForSelector.mockResolvedValue(null);
      const { runBrowserScreenshot } = await import("./tools.js");
      const result = await runBrowserScreenshot({ selector: "#missing" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Element not found");
    });
  });

  describe("browser_evaluate", () => {
    it("returns error for missing expression", async () => {
      const { runBrowserEvaluate } = await import("./tools.js");
      const result = await runBrowserEvaluate({});
      expect(result.is_error).toBe(true);
    });

    it("returns evaluated result as JSON", async () => {
      const { runBrowserEvaluate } = await import("./tools.js");
      const result = await runBrowserEvaluate({
        expression: "document.title",
      });
      expect(result.content).toContain('"key"');
      expect(result.content).toContain('"value"');
    });

    it("returns string results directly", async () => {
      mockPage.evaluate.mockResolvedValue("hello");
      const { runBrowserEvaluate } = await import("./tools.js");
      const result = await runBrowserEvaluate({
        expression: "document.title",
      });
      expect(result.content).toBe("hello");
    });

    it("truncates large results", async () => {
      mockPage.evaluate.mockResolvedValue("x".repeat(25_000));
      const { runBrowserEvaluate } = await import("./tools.js");
      const result = await runBrowserEvaluate({
        expression: "document.body.innerHTML",
      });
      expect(result.content).toContain("[Truncated");
    });
  });

  describe("browser_get_text", () => {
    it("returns body text by default", async () => {
      mockPage.evaluate.mockResolvedValue("Page body text here");
      const { runBrowserGetText } = await import("./tools.js");
      const result = await runBrowserGetText({});
      expect(result.content).toBe("Page body text here");
    });

    it("returns element text by selector", async () => {
      const { runBrowserGetText } = await import("./tools.js");
      const result = await runBrowserGetText({ selector: "#content" });
      expect(result.content).toBe("element text");
    });

    it("returns placeholder for empty text", async () => {
      mockPage.evaluate.mockResolvedValue("");
      const { runBrowserGetText } = await import("./tools.js");
      const result = await runBrowserGetText({});
      expect(result.content).toBe("(no visible text)");
    });

    it("truncates long text", async () => {
      mockPage.evaluate.mockResolvedValue("x".repeat(25_000));
      const { runBrowserGetText } = await import("./tools.js");
      const result = await runBrowserGetText({ max_length: 500 });
      expect(result.content).toContain("[Truncated");
      expect(result.content).toContain("showing first 500");
    });
  });

  describe("browser_close", () => {
    it("closes the browser", async () => {
      const { runBrowserClose } = await import("./tools.js");
      const result = await runBrowserClose();
      expect(result.content).toBe("Browser closed.");
      expect(closeBrowser).toHaveBeenCalled();
    });
  });
});

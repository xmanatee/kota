import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runBrowserClose,
  runBrowserEvaluate,
  runBrowserGetText,
  runBrowserScreenshot,
} from "./browser-observation-tools.js";

const mocks = vi.hoisted(() => ({
  closeBrowserSession: vi.fn(),
  getPage: vi.fn(),
}));

vi.mock("./lifecycle.js", () => ({
  closeBrowserSession: mocks.closeBrowserSession,
  getPage: mocks.getPage,
}));

describe("browser observation tool runners", () => {
  let page: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      waitForSelector: vi.fn().mockResolvedValue({
        screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
        innerText: vi.fn().mockResolvedValue("element text"),
      }),
      evaluate: vi.fn().mockResolvedValue({ key: "value" }),
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
    };
    mocks.getPage.mockResolvedValue(page);
  });

  describe("browser_screenshot", () => {
    it("captures a viewport screenshot with an image block", async () => {
      const result = await runBrowserScreenshot({});
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Screenshot captured");
      expect(result.content).toContain("Not a native desktop coordinate map");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks?.[0].type).toBe("image");
    });

    it("captures a selected element", async () => {
      const result = await runBrowserScreenshot({ selector: "#chart" });
      expect(result.is_error).toBeUndefined();
      expect(page.waitForSelector).toHaveBeenCalledWith("#chart", {
        timeout: 30_000,
      });
    });

    it("sets the requested viewport", async () => {
      await runBrowserScreenshot({ max_width: 800, max_height: 600 });
      expect(page.setViewportSize).toHaveBeenCalledWith({
        width: 800,
        height: 600,
      });
    });

    it("returns an error when the selected element is missing", async () => {
      page.waitForSelector.mockResolvedValue(null);
      const result = await runBrowserScreenshot({ selector: "#missing" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Element not found");
    });
  });

  describe("browser_evaluate", () => {
    it("requires an expression", async () => {
      expect((await runBrowserEvaluate({})).is_error).toBe(true);
    });

    it("serializes evaluated values", async () => {
      const result = await runBrowserEvaluate({
        expression: "document.title",
      });
      expect(result.content).toContain('"key"');
      expect(result.content).toContain('"value"');
    });

    it("returns string results directly", async () => {
      page.evaluate.mockResolvedValue("hello");
      const result = await runBrowserEvaluate({
        expression: "document.title",
      });
      expect(result.content).toBe("hello");
    });

    it("truncates large results", async () => {
      page.evaluate.mockResolvedValue("x".repeat(25_000));
      const result = await runBrowserEvaluate({
        expression: "document.body.innerHTML",
      });
      expect(result.content).toContain("[Truncated");
    });
  });

  describe("browser_get_text", () => {
    it("returns body text by default", async () => {
      page.evaluate.mockResolvedValue("Page body text here");
      expect((await runBrowserGetText({})).content).toBe(
        "Page body text here",
      );
    });

    it("returns selected element text", async () => {
      expect((await runBrowserGetText({ selector: "#content" })).content).toBe(
        "element text",
      );
    });

    it("represents empty text and truncates long text", async () => {
      page.evaluate.mockResolvedValue("");
      expect((await runBrowserGetText({})).content).toBe("(no visible text)");

      page.evaluate.mockResolvedValue("x".repeat(25_000));
      const truncated = await runBrowserGetText({ max_length: 500 });
      expect(truncated.content).toContain("[Truncated");
      expect(truncated.content).toContain("showing first 500");
    });
  });

  it("closes only the calling session", async () => {
    const context = {
      sessionId: "session-a",
      scopeId: "scope-a",
      cwd: "/scope-a",
    };
    const result = await runBrowserClose({}, context);
    expect(result.content).toBe("Browser closed.");
    expect(mocks.closeBrowserSession).toHaveBeenCalledWith(context);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runBrowserClick,
  runBrowserNavigate,
  runBrowserType,
} from "./browser-interaction-tools.js";

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock("./lifecycle.js", () => ({ getPage: mocks.getPage }));

describe("browser interaction tool runners", () => {
  let page: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({}),
      title: vi.fn().mockResolvedValue("Test Page"),
      url: vi.fn().mockReturnValue("https://example.com/test"),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getPage.mockResolvedValue(page);
  });

  describe("browser_navigate", () => {
    it("rejects a missing or invalid URL", async () => {
      expect((await runBrowserNavigate({})).is_error).toBe(true);
      const invalid = await runBrowserNavigate({ url: "ftp://example.com" });
      expect(invalid.is_error).toBe(true);
      expect(invalid.content).toContain("http://");
    });

    it("routes session context and returns the final page identity", async () => {
      const context = {
        sessionId: "session-a",
        scopeId: "scope-a",
        projectId: "scope-a",
        cwd: "/project-a",
      };
      const result = await runBrowserNavigate(
        { url: "https://example.com" },
        context,
      );

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("https://example.com/test");
      expect(result.content).toContain("Test Page");
      expect(page.goto).toHaveBeenCalledWith("https://example.com", {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      expect(mocks.getPage).toHaveBeenCalledWith(context);
    });

    it("waits for an optional selector", async () => {
      await runBrowserNavigate({
        url: "https://example.com",
        wait_for: "#main",
      });
      expect(page.waitForSelector).toHaveBeenCalledWith("#main", {
        timeout: 30_000,
      });
    });

    it("returns navigation errors", async () => {
      page.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const result = await runBrowserNavigate({
        url: "https://example.com",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("ERR_CONNECTION_REFUSED");
    });
  });

  describe("browser_click", () => {
    it("requires a selector", async () => {
      expect((await runBrowserClick({})).is_error).toBe(true);
    });

    it("clicks the selected element", async () => {
      const result = await runBrowserClick({ selector: "button.submit" });
      expect(result.content).toContain("Clicked: button.submit");
      expect(page.click).toHaveBeenCalledWith("button.submit", {
        timeout: 30_000,
      });
    });
  });

  describe("browser_type", () => {
    it("requires selector and text", async () => {
      expect((await runBrowserType({})).is_error).toBe(true);
    });

    it("types text into an input", async () => {
      const result = await runBrowserType({
        selector: "input#name",
        text: "Alice",
      });
      expect(result.content).toContain('Typed into input#name: "Alice"');
      expect(page.fill).toHaveBeenCalledWith("input#name", "Alice", {
        timeout: 30_000,
      });
    });

    it("clears the field first when requested", async () => {
      await runBrowserType({
        selector: "input#name",
        text: "Bob",
        clear: true,
      });
      expect(page.fill).toHaveBeenCalledTimes(2);
      expect(page.fill).toHaveBeenCalledWith("input#name", "", {
        timeout: 30_000,
      });
    });
  });
});

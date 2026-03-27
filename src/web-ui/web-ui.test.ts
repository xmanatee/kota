import { describe, expect, it } from "vitest";
import { getWebUI } from "./web-ui.js";

describe("getWebUI", () => {
  const html = getWebUI();

  it("returns valid HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes title", () => {
    expect(html).toContain("<title>KOTA</title>");
  });

  it("includes viewport meta for mobile", () => {
    expect(html).toContain('viewport');
    expect(html).toContain('width=device-width');
  });

  it("includes chat UI elements", () => {
    expect(html).toContain('id="messages"');
    expect(html).toContain('id="input"');
    expect(html).toContain('id="send"');
    expect(html).toContain('id="input-area"');
  });

  it("includes sidebar with session management", () => {
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="session-list"');
    expect(html).toContain('id="new-chat"');
  });

  it("includes history section", () => {
    expect(html).toContain('id="history-list"');
  });

  it("includes health indicator", () => {
    expect(html).toContain('id="health-status"');
  });

  it("includes CSS styles", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    expect(html).toContain("--accent:");
  });

  it("includes JavaScript", () => {
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
    expect(html).toContain("/api/chat");
    expect(html).toContain("/api/sessions");
    expect(html).toContain("/api/health");
  });

  it("includes API endpoint references for all features", () => {
    expect(html).toContain("/api/history");
    expect(html).toContain("/api/sessions");
    expect(html).toContain("/api/chat");
    expect(html).toContain("/api/health");
  });

  it("handles SSE streaming", () => {
    expect(html).toContain("getReader");
    expect(html).toContain("TextDecoder");
    expect(html).toContain('event: done');
  });

  it("includes markdown rendering", () => {
    expect(html).toContain("renderMarkdown");
    expect(html).toContain("escapeHtml");
  });

  it("includes keyboard shortcuts", () => {
    expect(html).toContain("Enter");
    expect(html).toContain("shiftKey");
  });

  it("has responsive design", () => {
    expect(html).toContain("@media");
    expect(html).toContain("768px");
  });

  it("includes history view bar element", () => {
    expect(html).toContain('id="history-view-bar"');
  });

  it("includes loadHistoryView function calling GET /api/history/:id", () => {
    expect(html).toContain("loadHistoryView");
    expect(html).toContain("/api/history/");
    expect(html).toContain("encodeURIComponent(id)");
  });

  it("includes historyViewId state for active history item tracking", () => {
    expect(html).toContain("historyViewId");
  });

  it("is deterministic — same output on repeated calls", () => {
    expect(getWebUI()).toBe(html);
  });
});

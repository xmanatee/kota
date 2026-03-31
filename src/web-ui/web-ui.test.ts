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

  it("includes session label localStorage helpers", () => {
    expect(html).toContain("getSessionLabel");
    expect(html).toContain("setSessionLabel");
    expect(html).toContain("clearSessionLabel");
    expect(html).toContain("kota-session-label:");
  });

  it("includes inline session label edit interaction", () => {
    expect(html).toContain("startSessionLabelEdit");
    expect(html).toContain("session-label-input");
    expect(html).toContain("ondblclick");
    expect(html).toContain("session-edit-btn");
  });

  it("session label cleared on session delete", () => {
    expect(html).toContain("clearSessionLabel(s.id)");
  });

  it("session list shows label when set, short UUID when not", () => {
    expect(html).toContain("getSessionLabel(s.id)");
    expect(html).toContain("session-label");
    expect(html).toContain("s.id.slice(0, 8)");
  });

  it("session label CSS styles are present", () => {
    expect(html).toContain("session-label-input");
    expect(html).toContain("session-edit-btn");
  });

  it("includes approvals panel element", () => {
    expect(html).toContain('id="approval-list"');
  });

  it("loads approvals from GET /api/approvals on init", () => {
    expect(html).toContain("/api/approvals");
    expect(html).toContain("refreshApprovals");
  });

  it("calls correct endpoints for approve and reject actions", () => {
    expect(html).toContain("/approve");
    expect(html).toContain("/reject");
  });

  it("refreshes approvals on approval.changed SSE event", () => {
    expect(html).toContain("approval.changed");
  });

  it("renders empty state when no approvals are pending", () => {
    expect(html).toContain("No pending approvals");
  });

  it("includes workflow history filter element", () => {
    expect(html).toContain('id="workflow-history-filter"');
  });

  it("includes renderHistoryFilter function", () => {
    expect(html).toContain("renderHistoryFilter");
  });

  it("includes applyHistoryFilter function", () => {
    expect(html).toContain("applyHistoryFilter");
  });

  it("includes workflow name and status filter selects", () => {
    expect(html).toContain("wf-filter-select");
    expect(html).toContain("wf-filter-row");
  });

  it("includes date range filter buttons", () => {
    expect(html).toContain("wf-date-btn");
    expect(html).toContain("wf-filter-dates");
    expect(html).toContain("data-range");
  });

  it("includes filter state variables", () => {
    expect(html).toContain("wfFilter");
    expect(html).toContain("_allRecentRuns");
    expect(html).toContain("_allActiveRuns");
  });

  it("fetches 50 runs for filterable history", () => {
    expect(html).toContain("limit=50");
  });

  it("includes active sessions panel element", () => {
    expect(html).toContain('id="active-sessions-list"');
  });

  it("loads active sessions from GET /api/daemon/status on init", () => {
    expect(html).toContain("refreshActiveSessions");
    expect(html).toContain("/api/daemon/status");
  });

  it("renders empty state when no sessions are active", () => {
    expect(html).toContain("No active sessions");
  });

  it("refreshes sessions on session.registered and session.unregistered SSE events", () => {
    expect(html).toContain("session.registered");
    expect(html).toContain("session.unregistered");
  });

  it("includes schedules panel element", () => {
    expect(html).toContain('id="schedules-list"');
  });

  it("loads schedules from GET /api/workflow/definitions on init", () => {
    expect(html).toContain("refreshSchedules");
    expect(html).toContain("/api/workflow/definitions");
  });

  it("renders empty state when no workflows have scheduled triggers", () => {
    expect(html).toContain("No scheduled workflows");
  });

  it("refreshes schedules on workflow.completed SSE event", () => {
    expect(html).toContain("refreshSchedules");
  });

  it("includes analytics panel element", () => {
    expect(html).toContain('id="cost-summary-list"');
    expect(html).toContain("Analytics");
  });

  it("renders per-workflow cost breakdown from API data", () => {
    expect(html).toContain("renderCost");
    expect(html).toContain("refreshCost");
    expect(html).toContain("/api/workflow/runs?since=");
  });

  it("includes configurable time window selector buttons", () => {
    expect(html).toContain("cost-window-btn");
    expect(html).toContain("cost-window-btns");
    expect(html).toContain("costWindowMs");
  });

  it("renders top-N most expensive runs with clickable links", () => {
    expect(html).toContain("cost-top-run");
    expect(html).toContain("cost-top-header");
    expect(html).toContain("Top runs");
    expect(html).toContain("showRunDetail");
  });

  it("refreshes cost panel on workflow.completed SSE event", () => {
    expect(html).toContain("workflow.completed");
    expect(html).toContain("refreshCost");
  });

  it("includes extensions panel element", () => {
    expect(html).toContain('id="extensions-list"');
    expect(html).toContain("Extensions");
  });

  it("loads extensions from GET /api/extensions on init", () => {
    expect(html).toContain("refreshExtensions");
    expect(html).toContain("/api/extensions");
  });

  it("renders empty state when no extensions are loaded", () => {
    expect(html).toContain("No extensions loaded");
  });

  it("uses long polling interval (≥5 min) for event-driven panels", () => {
    expect(html).toContain("setInterval(refreshWorkflows, 300000)");
    expect(html).toContain("setInterval(refreshApprovals, 300000)");
    expect(html).toContain("setInterval(refreshTasks, 300000)");
    expect(html).toContain("setInterval(refreshActiveSessions, 300000)");
    expect(html).toContain("setInterval(refreshSchedules, 300000)");
  });

  it("shows reconnecting indicator when SSE disconnects", () => {
    expect(html).toContain("warn");
    expect(html).toContain("Reconnecting...");
  });

  it("starts fallback polling when SSE disconnects", () => {
    expect(html).toContain("_startSseFallback");
    expect(html).toContain("_clearSseFallback");
    expect(html).toContain("_sseFallbackIntervals");
  });

  it("clears fallback polling and restores indicator when SSE reconnects", () => {
    expect(html).toContain("src.onopen");
    expect(html).toContain("_clearSseFallback");
  });
});

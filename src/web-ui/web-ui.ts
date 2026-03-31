/**
 * Embedded web UI for KOTA — a chat interface served directly from the HTTP server.
 * No build step, no external files. Assembles HTML from separated CSS and JS modules.
 */

import { WEB_UI_JS } from "./client.js";
import { WEB_UI_CSS } from "./styles.js";

export function getWebUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KOTA</title>
<style>
${WEB_UI_CSS}
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="sidebar-header">
      <h1>KOTA</h1>
      <button id="new-chat" title="New chat">+</button>
    </div>
    <div id="session-list"></div>
    <div class="sidebar-section">
      <h3>History</h3>
      <div id="history-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Approvals</h3>
      <div id="approval-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Tasks</h3>
      <div id="task-queue-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Workflows</h3>
      <div id="workflow-controls"></div>
      <div id="workflow-history-filter"></div>
      <div id="workflow-runs-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Sessions</h3>
      <div id="active-sessions-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Schedules</h3>
      <div id="schedules-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Analytics</h3>
      <div id="cost-summary-list"></div>
    </div>
    <div class="sidebar-section">
      <h3>Extensions</h3>
      <div id="extensions-list"></div>
    </div>
    <div class="sidebar-footer">
      <span id="health-status">●</span>
      <button id="toggle-sidebar" class="icon-btn" title="Toggle sidebar">☰</button>
    </div>
  </aside>
  <main id="chat-area">
    <div id="run-detail"></div>
    <div id="messages"></div>
    <div id="history-view-bar"></div>
    <div id="input-area">
      <textarea id="input" placeholder="Message KOTA..." rows="1"></textarea>
      <button id="send" title="Send">→</button>
    </div>
  </main>
</div>
<script>
${WEB_UI_JS}
</script>
</body>
</html>`;
}

/**
 * CSS styles for the KOTA web UI.
 * Extracted from web-ui.ts for structural clarity.
 */

export const WEB_UI_CSS = /* css */ `
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-chat: #0f0f23;
  --text: #e0e0e0;
  --text-muted: #8888aa;
  --accent: #6c63ff;
  --accent-hover: #5a52d5;
  --user-bg: #2a2a4a;
  --assistant-bg: #1e1e3a;
  --border: #2a2a4a;
  --input-bg: #1e1e3a;
  --sidebar-w: 260px;
  --radius: 8px;
}

html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg-chat);
  color: var(--text);
}

#app {
  display: flex;
  height: 100vh;
}

/* --- Sidebar --- */
#sidebar {
  width: var(--sidebar-w);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s;
}
#sidebar.collapsed { width: 0; border-right: none; }

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.sidebar-header h1 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--accent);
}
#new-chat {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#new-chat:hover { background: var(--accent-hover); }

.sidebar-section { padding: 8px 12px; }
.sidebar-section h3 {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
  letter-spacing: 1px;
}

#session-list, #history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
#history-list { max-height: 300px; }

.session-item, .history-item {
  padding: 8px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.session-item:hover, .history-item:hover { background: var(--border); }
.session-item.active { background: var(--accent); color: #fff; }
.session-item .delete-btn, .history-item .delete-btn {
  opacity: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.session-item:hover .delete-btn, .history-item:hover .delete-btn { opacity: 1; }

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}
#health-status { font-size: 10px; }
#health-status.ok { color: #4caf50; }
#health-status.err { color: #f44336; }
.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}

/* --- Chat area --- */
#chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: 14px 18px;
  border-radius: var(--radius);
  line-height: 1.6;
  font-size: 14px;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.message.user {
  background: var(--user-bg);
  border-left: 3px solid var(--accent);
}
.message.assistant {
  background: var(--assistant-bg);
}
.message.status {
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 4px;
}
.message.error {
  background: #2a1020;
  border-left: 3px solid #f44336;
  color: #ff8a80;
}

.message pre {
  background: #0a0a1a;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.4;
}
.message code {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 13px;
}
.message :not(pre) > code {
  background: #0a0a1a;
  padding: 2px 6px;
  border-radius: 4px;
}

.typing-indicator {
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}

/* --- Input area --- */
#input-area {
  padding: 16px 24px;
  display: flex;
  gap: 8px;
  max-width: 848px;
  width: 100%;
  margin: 0 auto;
}

#input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 12px 16px;
  font-family: inherit;
  font-size: 14px;
  resize: none;
  max-height: 200px;
  outline: none;
}
#input:focus { border-color: var(--accent); }

#send {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 44px;
  border-radius: var(--radius);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#send:hover { background: var(--accent-hover); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Welcome */
.welcome {
  text-align: center;
  color: var(--text-muted);
  margin: auto;
  padding: 40px;
}
.welcome h2 {
  font-size: 24px;
  color: var(--accent);
  margin-bottom: 12px;
}
.welcome p { font-size: 14px; line-height: 1.8; }

/* Workflow runs panel */
#workflow-runs-list {
  max-height: 180px;
  overflow-y: auto;
  padding: 2px 0;
}
.run-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  border-radius: var(--radius);
  margin-bottom: 1px;
}
.run-badge {
  font-size: 10px;
  font-weight: 700;
  min-width: 14px;
  text-align: center;
  flex-shrink: 0;
}
.run-badge.success { color: #4caf50; }
.run-badge.failed { color: #f44336; }
.run-badge.interrupted { color: #ff9800; }
.run-badge.running { color: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.run-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.run-meta {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.run-empty {
  padding: 4px 12px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}

/* Mobile */
@media (max-width: 768px) {
  #sidebar { position: fixed; z-index: 10; height: 100%; }
  #sidebar.collapsed { width: 0; }
  .toggle-visible { display: block !important; }
}
`;

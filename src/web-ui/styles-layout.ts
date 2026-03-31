/** CSS variables, reset, layout, and sidebar styles for the KOTA web UI. */

export const STYLES_LAYOUT_CSS = `
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
.history-item.active { background: var(--accent); color: #fff; }
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
#health-status.warn { color: #ff9800; }
.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}
`;

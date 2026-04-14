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

/* Mobile menu button — hidden on desktop, shown on small screens */
#mobile-menu-btn {
  display: none;
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 200;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text);
  width: 36px;
  height: 36px;
  border-radius: var(--radius);
  font-size: 18px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
}

/* Sidebar backdrop overlay for mobile */
.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 99;
}

/* Tablet: sidebar slides in as overlay, main panel takes full width */
@media (max-width: 768px) {
  #mobile-menu-btn { display: flex; }

  #sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 100;
    width: var(--sidebar-w);
    transform: translateX(0);
    transition: transform 0.2s;
  }

  #sidebar.collapsed {
    width: var(--sidebar-w);
    border-right: 1px solid var(--border);
    transform: translateX(-100%);
  }

  #chat-area {
    width: 100%;
    min-width: 0;
  }
}

/* Mobile: single-column, no horizontal overflow */
@media (max-width: 480px) {
  #app {
    overflow-x: hidden;
  }

  #chat-area {
    overflow-x: hidden;
  }

  #input-area {
    padding: 8px;
  }
}

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
.session-edit-btn {
  opacity: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}
.session-item:hover .session-edit-btn { opacity: 1; }
.session-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.session-label-input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--accent);
  color: var(--text);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 13px;
  outline: none;
}

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

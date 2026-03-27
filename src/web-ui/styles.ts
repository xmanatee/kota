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

/* Cost summary panel */
#cost-summary-list {
  max-height: 120px;
  overflow-y: auto;
  padding: 2px 0;
}
.cost-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 12px;
  font-size: 12px;
}
.cost-workflow {
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.cost-amount {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  padding-left: 8px;
}
.cost-total {
  border-top: 1px solid var(--border);
  margin-top: 2px;
  padding-top: 4px;
  font-weight: 600;
}
.cost-total .cost-amount { color: var(--text); }

/* Step progress panel */
.step-progress {
  max-width: 800px;
  width: 100%;
  margin: 0 auto 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
}
.step-progress-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--assistant-bg);
  font-size: 12px;
}
.step-progress-item.active {
  background: rgba(108, 99, 255, 0.15);
  outline: 1px solid var(--accent);
}
.step-progress-name {
  color: var(--text-muted);
  white-space: nowrap;
}
.run-badge.pending { color: var(--text-muted); }

/* Run detail panel */
#run-detail {
  display: none;
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  flex-direction: column;
  gap: 16px;
}
#run-detail.visible { display: flex; }
.run-detail-back {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  align-self: flex-start;
  margin-bottom: 8px;
}
.run-detail-back:hover { background: var(--border); }
.run-detail-header {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}
.run-detail-title {
  font-size: 18px;
  font-weight: 700;
  margin: 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.run-detail-meta {
  color: var(--text-muted);
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.run-detail-meta code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 12px;
  background: #0a0a1a;
  padding: 1px 5px;
  border-radius: 3px;
}
.run-detail-steps {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}
.step-row {
  background: var(--assistant-bg);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 6px;
}
.step-row-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.step-row-name {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
}
.step-row-meta {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}
.step-row-output {
  color: var(--text-muted);
  font-size: 11px;
  font-family: "SF Mono", "Fira Code", monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60px;
  overflow: hidden;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

/* Approval panel */
#approval-list {
  max-height: 200px;
  overflow-y: auto;
  padding: 2px 0;
}
.approval-item {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: var(--radius);
  margin-bottom: 4px;
  background: var(--assistant-bg);
}
.approval-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.approval-risk {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  text-transform: uppercase;
}
.approval-risk.dangerous { background: #5a1010; color: #f44336; }
.approval-risk.moderate { background: #3a2800; color: #ff9800; }
.approval-risk.safe { background: #0a2a0a; color: #4caf50; }
.approval-tool {
  flex: 1;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.approval-reason {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.approval-actions {
  display: flex;
  gap: 4px;
}
.approval-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 600;
}
.approval-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.approval-approve { background: #1a3a1a; color: #4caf50; }
.approval-approve:hover:not(:disabled) { background: #1e4a1e; }
.approval-reject { background: #3a1a1a; color: #f44336; }
.approval-reject:hover:not(:disabled) { background: #4a1e1e; }

/* Task queue panel */
#task-queue-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 2px 0;
}
.task-group-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--radius);
  margin-bottom: 1px;
}
.task-group-header:hover { background: var(--border); }
.task-group-label {
  flex: 1;
  font-weight: 600;
  color: var(--text);
}
.task-group-count {
  color: var(--text-muted);
  font-size: 11px;
  background: var(--bg);
  padding: 0 5px;
  border-radius: 8px;
}
.task-group-toggle {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
}
.task-item {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: var(--radius);
  margin-bottom: 1px;
  cursor: pointer;
}
.task-item:hover { background: var(--border); }
.task-item.expanded { background: var(--assistant-bg); }
.task-item-header {
  display: flex;
  align-items: center;
  gap: 5px;
}
.task-priority {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  text-transform: uppercase;
}
.task-priority-p0 { background: #5a1010; color: #f44336; }
.task-priority-p1 { background: #3a2800; color: #ff9800; }
.task-priority-p2 { background: #1a2a3a; color: #64b5f6; }
.task-priority-p3 { background: var(--bg); color: var(--text-muted); }
.task-item-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.task-item-area {
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.task-item-summary {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-item-body {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  line-height: 1.5;
}
.task-item-body h2, .task-item-body h3, .task-item-body h4 {
  color: var(--text);
  margin: 6px 0 3px;
  font-size: 12px;
}
.task-item-body strong { color: var(--text); }
.task-item-body code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 10px;
  background: #0a0a1a;
  padding: 1px 4px;
  border-radius: 3px;
}

/* Workflow controls */
.wf-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0 6px;
}
.wf-ctrl-btn {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.wf-ctrl-btn:hover { border-color: var(--accent); color: var(--text); }
.wf-ctrl-btn.pause { color: #f59e0b; border-color: #f59e0b55; }
.wf-ctrl-btn.pause:hover { background: #f59e0b22; }
.wf-ctrl-btn.resume { color: #34d399; border-color: #34d39955; }
.wf-ctrl-btn.resume:hover { background: #34d39922; }
.wf-ctrl-btn.trigger { color: var(--accent); border-color: #6c63ff55; }
.wf-ctrl-btn.trigger:hover { background: #6c63ff22; }
.wf-ctrl-btn:disabled { opacity: 0.5; cursor: default; }

/* Mobile */
@media (max-width: 768px) {
  #sidebar { position: fixed; z-index: 10; height: 100%; }
  #sidebar.collapsed { width: 0; }
  .toggle-visible { display: block !important; }
}
`;

/** Approval, task queue, workflow controls, and mobile styles for the KOTA web UI. */

export const STYLES_PANELS_CSS = `
/* Status overview panel */
#overview-list {
  padding: 2px 0 4px;
}
.overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 12px;
  font-size: 12px;
  border-radius: var(--radius);
  gap: 6px;
}
.overview-row:hover { background: var(--border); }
.overview-label {
  color: var(--text-muted);
  flex-shrink: 0;
  min-width: 70px;
}
.overview-value {
  color: var(--text);
  text-align: right;
  flex: 1;
}
.overview-ok { color: #34d399; }
.overview-warn { color: #f59e0b; }
.overview-err { color: #f87171; }
.overview-running { color: var(--accent); }

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
.approval-input {
  margin: 4px 0;
  font-size: 11px;
}
.approval-input-toggle {
  cursor: pointer;
  color: var(--text-muted);
  user-select: none;
  font-size: 11px;
  padding: 1px 0;
}
.approval-input-toggle:focus { outline: 1px dashed var(--accent); }
.approval-input-pre {
  margin: 4px 0 2px;
  padding: 6px;
  background: var(--bg);
  border-radius: 3px;
  font-size: 10px;
  font-family: monospace;
  overflow-x: auto;
  white-space: pre;
  max-height: 180px;
  overflow-y: auto;
  color: var(--text);
}
.approval-input-full {
  font-size: 10px;
  padding: 1px 6px;
  border: none;
  border-radius: 3px;
  background: var(--assistant-bg);
  color: var(--text-muted);
  cursor: pointer;
}
.approval-input-full:hover { color: var(--text); }

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
.task-item-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  margin-left: auto;
}
.task-action-btn {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.task-action-btn:hover { border-color: var(--accent); color: var(--text); }
.task-action-btn.danger:hover { border-color: #f87171; color: #f87171; }
.task-edit-textarea {
  width: 100%;
  min-height: 120px;
  font-size: 11px;
  font-family: "SF Mono", "Fira Code", monospace;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  resize: vertical;
  box-sizing: border-box;
  margin-top: 6px;
  line-height: 1.5;
}
.task-edit-textarea:focus { outline: none; border-color: var(--accent); }
.task-edit-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

/* New task form */
.new-task-form {
  padding: 6px 0 2px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}
.new-task-row {
  display: flex;
  gap: 4px;
  margin-bottom: 3px;
}
.new-task-input {
  flex: 1;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  min-width: 0;
}
.new-task-input:focus { outline: none; border-color: var(--accent); }
.new-task-input::placeholder { color: var(--text-muted); }
.new-task-submit {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.new-task-submit:hover { background: #6c63ff22; border-color: var(--accent); }

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
.wf-ctrl-btn.abort { color: #f87171; border-color: #f8717155; }
.wf-ctrl-btn.abort:hover { background: #f8717122; }
.wf-ctrl-btn.retry { color: #a78bfa; border-color: #a78bfa55; }
.wf-ctrl-btn.retry:hover { background: #a78bfa22; }
.wf-ctrl-btn:disabled { opacity: 0.5; cursor: default; }
.wf-window-blocked-badge { font-size: 0.78em; padding: 3px 8px; border-radius: 4px; border: 1px solid #f59e0b55; color: #f59e0b; background: #f59e0b11; white-space: nowrap; }
.run-retry-btn { margin-left: auto; }

/* Workflow history filter */
#workflow-history-filter {
  padding: 2px 0 4px;
}
.wf-filter-row {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.wf-filter-select {
  flex: 1;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  min-width: 0;
  cursor: pointer;
}
.wf-filter-select:focus { outline: none; border-color: var(--accent); color: var(--text); }
.wf-filter-search-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
}
.wf-filter-search {
  flex: 1;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  min-width: 0;
}
.wf-filter-search::placeholder { color: var(--text-muted); opacity: 0.6; }
.wf-filter-search:focus { outline: none; border-color: var(--accent); color: var(--text); }
.wf-filter-search-clear {
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.wf-filter-search-clear:hover { border-color: var(--accent); color: var(--text); }
.wf-filter-dates {
  display: flex;
  gap: 3px;
}
.wf-date-btn {
  flex: 1;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.wf-date-btn:hover { border-color: var(--accent); color: var(--text); }
.wf-date-btn.active { border-color: var(--accent); color: var(--accent); background: #6c63ff22; }
.wf-load-more-btn {
  display: block;
  width: 100%;
  margin-top: 6px;
  font-size: 10px;
  padding: 4px 0;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  text-align: center;
}
.wf-load-more-btn:hover { border-color: var(--accent); color: var(--text); }
.wf-load-more-btn:disabled { opacity: 0.5; cursor: default; }

/* Workflow input form (inline before triggering workflows with inputSchema) */
.wf-input-form {
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-alt, var(--bg));
}
.wf-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.wf-input-label {
  font-size: 10px;
  color: var(--text-muted);
  min-width: 70px;
  flex-shrink: 0;
}
.wf-input-field {
  flex: 1;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  min-width: 0;
}
.wf-input-field:focus { outline: none; border-color: var(--accent); }
.wf-input-field.wf-input-error { border-color: #f87171; }
.wf-input-checkbox { cursor: pointer; }
.wf-input-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

/* Responsive overrides handled in styles-layout.ts */
`;

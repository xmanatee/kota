/** Approval, task queue, workflow controls, and mobile styles for the KOTA web UI. */

export const STYLES_PANELS_CSS = `
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

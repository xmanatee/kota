/** Workflow runs, cost summary, step progress, and run detail styles for the KOTA web UI. */

export const STYLES_RUNS_CSS = `
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
`;

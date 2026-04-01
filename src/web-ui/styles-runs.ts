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
.run-item-selected {
  background: rgba(108, 99, 255, 0.18);
  outline: 1px solid var(--accent);
}
.run-empty {
  padding: 4px 12px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
.run-tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  background: #6c63ff33;
  color: var(--accent);
  margin-left: 4px;
  vertical-align: middle;
  letter-spacing: 0.03em;
}

/* Cost analytics panel */
#cost-summary-list {
  max-height: 260px;
  overflow-y: auto;
  padding: 2px 0;
}
.cost-window-btns {
  display: flex;
  gap: 3px;
  padding: 2px 12px 6px;
}
.cost-window-btn {
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
.cost-window-btn:hover { border-color: var(--accent); color: var(--text); }
.cost-window-btn.active { border-color: var(--accent); color: var(--accent); background: #6c63ff22; }
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
.cost-top-header {
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}
.cost-top-run {
  display: flex;
  justify-content: space-between;
  padding: 3px 12px;
  font-size: 11px;
  border-radius: var(--radius);
}
.cost-top-run:hover { background: var(--border); }

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
.run-detail-replay {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  align-self: flex-start;
  margin-bottom: 8px;
  margin-left: 8px;
}
.run-detail-replay:hover:not(:disabled) { background: var(--border); }
.run-detail-replay:disabled { opacity: 0.6; cursor: default; }
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
  overflow: hidden;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.step-show-more {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
  margin-top: 2px;
}
.step-show-more:hover { text-decoration: underline; }
.log-search-bar {
  max-width: 800px;
  width: 100%;
  margin: 0 auto 8px;
}
.log-search-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  padding: 6px 10px;
  outline: none;
}
.log-search-input:focus { border-color: var(--accent); }
mark.log-match {
  background: #ff0;
  color: #000;
  border-radius: 2px;
  padding: 0 1px;
}

/* Run artifact summary */
.run-artifacts {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  padding: 12px 14px;
  border-left: 3px solid var(--accent);
}
.run-artifacts-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.run-artifact-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 4px;
}
.run-artifact-label {
  color: var(--text-muted);
  font-size: 11px;
  min-width: 52px;
  flex-shrink: 0;
}
.run-artifact-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.run-artifact-pre {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 11px;
  white-space: pre-wrap;
  margin: 0;
  color: var(--text-muted);
}
.run-artifacts code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 11px;
  background: #0a0a1a;
  padding: 1px 5px;
  border-radius: 3px;
}

/* Run diff / compare */
.run-compare-section {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}
.run-compare-header {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.run-compare-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.run-compare-select {
  flex: 1;
  min-width: 180px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 8px;
  border-radius: var(--radius);
  font-size: 12px;
}
.run-compare-btn {
  background: var(--bg);
  border: 1px solid var(--accent);
  color: var(--accent);
  padding: 4px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.run-compare-btn:hover:not(:disabled) { background: #6c63ff22; }
.run-compare-btn:disabled { opacity: 0.4; cursor: default; }
.run-diff-wrap {
  margin-top: 12px;
}
.run-diff-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
  word-break: break-all;
}
.run-diff-subtitle code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 10px;
  background: #0a0a1a;
  padding: 1px 4px;
  border-radius: 3px;
}
.run-diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.run-diff-table th {
  text-align: left;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.run-diff-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  font-family: "SF Mono", "Fira Code", monospace;
}
.run-diff-table tr:last-child td { border-bottom: none; }
.run-diff-table tr.diff-regressed td { background: rgba(244, 67, 54, 0.07); }
.run-diff-table tr.diff-improved td { background: rgba(76, 175, 80, 0.07); }
.diff-worse { color: #f44336; }
.diff-better { color: #4caf50; }
`;

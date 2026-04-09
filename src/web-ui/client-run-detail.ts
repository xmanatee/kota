/** Run detail panel: load, render metadata/artifacts, and hash-based permalink navigation. */

export const CLIENT_RUN_DETAIL_JS = `
  async function showRunDetail(runId) {
    closeStream();
    history.replaceState(null, "", "#run=" + encodeURIComponent(runId));
    $messages.style.display = "none";
    $inputArea.style.display = "none";
    $runDetail.innerHTML = '<div style="color:var(--text-muted);padding:24px">Loading\u2026</div>';
    $runDetail.classList.add("visible");
    try {
      var res = await apiFetch(API +"/api/workflow/runs/" + encodeURIComponent(runId));
      if (!res.ok) {
        $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Run not found</div>';
        return;
      }
      var run = await res.json();
      var artifacts = null;
      try {
        var aRes = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(runId) + "/artifacts");
        if (aRes.ok) artifacts = await aRes.json();
      } catch (err) {
        console.warn("[kota-web-ui] Failed to load run artifacts", err);
      }
      var thinkingData = null;
      try {
        var tRes = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(runId) + "/thinking");
        if (tRes.ok) { var td = await tRes.json(); thinkingData = td.thinking || null; }
      } catch (err) {
        console.warn("[kota-web-ui] Failed to load run thinking", err);
      }
      var triggeredRuns = null;
      try {
        var trRes = await apiFetch(API + "/api/workflow/runs?causedByRunId=" + encodeURIComponent(runId));
        if (trRes.ok) { var trData = await trRes.json(); triggeredRuns = trData.runs || null; }
      } catch (err) {
        console.warn("[kota-web-ui] Failed to load triggered runs", err);
      }
      renderRunDetail(run, artifacts, thinkingData, triggeredRuns);
      renderCompareSection(run);
      if (run.status === "running") {
        startRunStream(runId);
      }
    } catch (err) {
      $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Error: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRunDetail(run, artifacts, thinkingData, triggeredRuns) {
    var badgeClass = run.status === "success" ? "success" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "interrupted";
    var icon = run.status === "success" ? "\\u2713" : run.status === "failed" ? "\\u2717" : run.status === "running" ? "\\u25b6" : "\\u26a1";
    var duration = run.durationMs ? fmtDuration(run.durationMs) : (run.status === "running" ? fmtDuration(Date.now() - new Date(run.startedAt).getTime()) : "\\u2014");
    var cost = run.totalCostUsd != null ? "$" + run.totalCostUsd.toFixed(4) : "\\u2014";
    var started = new Date(run.startedAt).toLocaleString();
    var completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : "\\u2014";
    var html = '<div class="run-detail-header">';
    html += '<button class="run-detail-back" id="run-detail-back">\\u2190 Back</button>';
    if (run.status === "running" || run.status === "repairing") {
      html += '<button class="run-detail-abort" id="run-detail-abort">\\u23f9 Abort</button>';
    }
    if (run.status !== "running" && run.status !== "repairing") {
      html += '<button class="run-detail-replay" id="run-detail-replay">\\u21ba Replay</button>';
    }
    if (run.status === "failed" || run.status === "interrupted") {
      html += '<button class="run-detail-retry" id="run-detail-retry">\\u21ba Retry</button>';
    }
    html += '<div class="run-detail-title"><span class="run-badge ' + badgeClass + '">' + icon + '</span>' + escapeHtml(run.workflow) + '</div>';
    html += '<div class="run-detail-meta">';
    html += '<span>ID: <code>' + escapeHtml(run.id) + '</code></span>';
    html += '<span>Status: ' + escapeHtml(run.status) + '</span>';
    html += '<span>Duration: ' + duration + '</span>';
    html += '<span>Cost: ' + cost + '</span>';
    html += '<span>Started: ' + escapeHtml(started) + '</span>';
    html += '<span>Completed: ' + escapeHtml(completed) + '</span>';
    if (run.causedBy) {
      html += '<span>Triggered by: <a href="#" class="run-causedby-link" data-runid="' + escapeHtml(run.causedBy.runId) + '">' + escapeHtml(run.causedBy.workflow) + ' / ' + escapeHtml(run.causedBy.runId) + '</a></span>';
    }
    if (triggeredRuns && triggeredRuns.length > 0) {
      html += '<span>Triggered runs: ';
      for (var tri = 0; tri < triggeredRuns.length; tri++) {
        var tr = triggeredRuns[tri];
        var trIcon = tr.status === "success" ? "\\u2713" : tr.status === "failed" ? "\\u2717" : tr.status === "running" ? "\\u25b6" : "\\u26a1";
        var trBadge = tr.status === "success" ? "success" : tr.status === "failed" ? "failed" : tr.status === "running" ? "running" : "interrupted";
        if (tri > 0) html += " ";
        html += '<a href="#" class="run-causedby-link" data-runid="' + escapeHtml(tr.id) + '"><span class="run-badge ' + trBadge + '">' + trIcon + '</span> ' + escapeHtml(tr.workflow) + ' / ' + escapeHtml(tr.id) + '</a>';
      }
      html += '</span>';
    }
    html += '</div></div>';

    if (run.warnings && run.warnings.length > 0) {
      html += '<div class="run-warnings">';
      html += '<div class="run-warnings-title">\\u26a0 Warnings</div>';
      for (var wi2 = 0; wi2 < run.warnings.length; wi2++) {
        var w = run.warnings[wi2];
        html += '<div class="run-warning-row"><code>' + escapeHtml(w.type) + '</code> ' + escapeHtml(w.message) + '</div>';
      }
      html += '</div>';
    }

    if (artifacts && artifacts.runSummary) {
      var s = artifacts.runSummary;
      html += '<div class="run-artifacts">';
      html += '<div class="run-artifacts-title">Run Summary</div>';
      if (s.taskTitle) html += '<div class="run-artifact-row"><span class="run-artifact-label">Task</span><span>' + escapeHtml(s.taskTitle) + '</span></div>';
      html += '<div class="run-artifact-row"><span class="run-artifact-label">Commit</span><code>' + escapeHtml(s.commitSha.slice(0, 8)) + '</code> ' + escapeHtml(s.commitMessage) + '</div>';
      if (s.filesChanged && s.filesChanged.length > 0) {
        html += '<div class="run-artifact-row"><span class="run-artifact-label">Files</span><span class="run-artifact-files">' + s.filesChanged.map(function(f) { return '<code>' + escapeHtml(f) + '</code>'; }).join(' ') + '</span></div>';
      }
      html += '</div>';
    } else if (artifacts && artifacts.commitMessage) {
      html += '<div class="run-artifacts">';
      html += '<div class="run-artifacts-title">Commit</div>';
      html += '<div class="run-artifact-row"><pre class="run-artifact-pre">' + escapeHtml(artifacts.commitMessage) + '</pre></div>';
      html += '</div>';
    }

    html += renderStepRowsHtml(run, thinkingData);
    $runDetail.innerHTML = html;
    bindRunDetailControls(run);
  }

  function _openRunFromHash() {
    var hash = window.location.hash;
    if (!hash.startsWith("#run=")) return;
    var runId = decodeURIComponent(hash.slice(5));
    if (!runId) return;
    var found = (_allRecentRuns || []).some(function(r) { return r.id === runId; });
    if (found) showRunDetail(runId);
  }
`;

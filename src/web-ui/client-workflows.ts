/** Workflow controls, run list, and refresh functions for the KOTA web UI. */

export const CLIENT_WORKFLOWS_JS = `
  // --- Workflow controls ---

  function renderWorkflowControls(paused, workflowNames) {
    $workflowControls.innerHTML = "";
    var row = document.createElement("div");
    row.className = "wf-controls";

    var pauseBtn = document.createElement("button");
    pauseBtn.className = "wf-ctrl-btn " + (paused ? "resume" : "pause");
    pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
    pauseBtn.onclick = async function() {
      pauseBtn.disabled = true;
      try {
        await fetch(API + (paused ? "/api/workflow/resume" : "/api/workflow/pause"), { method: "POST" });
        await refreshWorkflows();
      } finally {
        pauseBtn.disabled = false;
      }
    };
    row.appendChild(pauseBtn);

    for (var i = 0; i < workflowNames.length; i++) {
      (function(name) {
        var btn = document.createElement("button");
        btn.className = "wf-ctrl-btn trigger";
        btn.textContent = "▶ " + name;
        btn.title = "Trigger " + name;
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            var r = await fetch(API + "/api/workflow/trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: name }),
            });
            if (!r.ok) {
              var d = await r.json();
              btn.title = d.error || "Error";
            } else {
              btn.title = "Queued!";
            }
            await refreshWorkflows();
          } finally {
            btn.disabled = false;
          }
        };
        row.appendChild(btn);
      })(workflowNames[i]);
    }

    $workflowControls.appendChild(row);
  }

  // --- Workflow runs panel ---

  function renderWorkflows(activeRuns, recentRuns) {
    $workflowList.innerHTML = "";
    var shown = 0;

    for (var i = 0; i < activeRuns.length; i++) {
      var run = activeRuns[i];
      var elapsed = Date.now() - new Date(run.startedAt).getTime();
      var item = document.createElement("div");
      item.className = "run-item";
      item.style.cursor = "pointer";
      item.innerHTML = '<span class="run-badge running">▶</span>' +
        '<span class="run-name">' + escapeHtml(run.workflow) + '</span>' +
        '<span class="run-meta">' + fmtDuration(elapsed) + '</span>';
      item.onclick = (function(id) { return function() { showRunDetail(id); }; })(run.runId);
      $workflowList.appendChild(item);
      shown++;
    }

    var activeIds = {};
    for (var j = 0; j < activeRuns.length; j++) activeIds[activeRuns[j].runId] = true;

    for (var k = 0; k < recentRuns.length && shown < 10; k++) {
      var r = recentRuns[k];
      if (r.status === "running" || activeIds[r.id]) continue;
      var badgeClass = r.status === "success" ? "success" : r.status === "failed" ? "failed" : "interrupted";
      var icon = r.status === "success" ? "✓" : r.status === "failed" ? "✗" : "⚡";
      var meta = (r.durationMs ? fmtDuration(r.durationMs) : "") + (r.totalCostUsd != null ? " $" + r.totalCostUsd.toFixed(3) : "");
      var ri = document.createElement("div");
      ri.className = "run-item";
      ri.style.cursor = "pointer";
      ri.innerHTML = '<span class="run-badge ' + badgeClass + '">' + icon + '</span>' +
        '<span class="run-name">' + escapeHtml(r.workflow) + '</span>' +
        '<span class="run-meta">' + meta.trim() + '</span>';
      ri.onclick = (function(id) { return function() { showRunDetail(id); }; })(r.id);
      $workflowList.appendChild(ri);
      shown++;
    }

    if (shown === 0) {
      $workflowList.innerHTML = '<div class="run-empty">No recent runs</div>';
    }
  }

  async function refreshWorkflows() {
    try {
      var statusRes = await fetch(API + "/api/workflow/status");
      var runsRes = await fetch(API + "/api/workflow/runs?limit=10");
      if (!statusRes.ok || !runsRes.ok) return;
      var statusData = await statusRes.json();
      var runsData = await runsRes.json();
      renderWorkflows(statusData.activeRuns || [], runsData.runs || []);
      var wfNames = Object.keys(statusData.workflows || {}).sort();
      renderWorkflowControls(!!statusData.paused, wfNames);
    } catch {}
  }
`;

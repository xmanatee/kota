/** Workflow controls, run list, filter, and refresh functions for the KOTA web UI. */

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

  // --- History filter state ---

  var _allRecentRuns = [];
  var _allActiveRuns = [];
  var wfFilter = { workflow: "", status: "", dateRange: "all" };

  function renderHistoryFilter(workflowNames) {
    $workflowHistoryFilter.innerHTML = "";

    var row1 = document.createElement("div");
    row1.className = "wf-filter-row";

    var wfSel = document.createElement("select");
    wfSel.className = "wf-filter-select";
    wfSel.title = "Filter by workflow";
    var allWfOpt = document.createElement("option");
    allWfOpt.value = "";
    allWfOpt.textContent = "All";
    wfSel.appendChild(allWfOpt);
    for (var i = 0; i < workflowNames.length; i++) {
      var wfOpt = document.createElement("option");
      wfOpt.value = workflowNames[i];
      wfOpt.textContent = workflowNames[i];
      wfSel.appendChild(wfOpt);
    }
    wfSel.value = wfFilter.workflow;
    wfSel.onchange = function() { wfFilter.workflow = wfSel.value; applyHistoryFilter(); };
    row1.appendChild(wfSel);

    var stSel = document.createElement("select");
    stSel.className = "wf-filter-select";
    stSel.title = "Filter by status";
    [["", "Any status"], ["failed", "Failed"], ["success", "Completed"], ["interrupted", "Interrupted"]].forEach(function(pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      stSel.appendChild(opt);
    });
    stSel.value = wfFilter.status;
    stSel.onchange = function() { wfFilter.status = stSel.value; applyHistoryFilter(); };
    row1.appendChild(stSel);

    $workflowHistoryFilter.appendChild(row1);

    var row2 = document.createElement("div");
    row2.className = "wf-filter-dates";
    [["all", "All time"], ["today", "Today"], ["7d", "7 days"]].forEach(function(pair) {
      var btn = document.createElement("button");
      btn.className = "wf-date-btn" + (wfFilter.dateRange === pair[0] ? " active" : "");
      btn.textContent = pair[1];
      btn.setAttribute("data-range", pair[0]);
      btn.onclick = (function(range, b) {
        return function() {
          wfFilter.dateRange = range;
          row2.querySelectorAll(".wf-date-btn").forEach(function(x) { x.classList.remove("active"); });
          b.classList.add("active");
          applyHistoryFilter();
        };
      })(pair[0], btn);
      row2.appendChild(btn);
    });
    $workflowHistoryFilter.appendChild(row2);
  }

  function applyHistoryFilter() {
    var cutoff = 0;
    if (wfFilter.dateRange === "today") {
      var d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime();
    } else if (wfFilter.dateRange === "7d") {
      cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    var filtered = _allRecentRuns.filter(function(r) {
      if (wfFilter.workflow && r.workflow !== wfFilter.workflow) return false;
      if (wfFilter.status && r.status !== wfFilter.status) return false;
      if (cutoff && new Date(r.startedAt).getTime() < cutoff) return false;
      return true;
    });
    renderWorkflows(_allActiveRuns, filtered);
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

    for (var k = 0; k < recentRuns.length && shown < 50; k++) {
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
      var runsRes = await fetch(API + "/api/workflow/runs?limit=50");
      if (!statusRes.ok || !runsRes.ok) return;
      var statusData = await statusRes.json();
      var runsData = await runsRes.json();
      _allActiveRuns = statusData.activeRuns || [];
      _allRecentRuns = runsData.runs || [];
      var wfNames = Object.keys(statusData.workflows || {}).sort();
      renderWorkflowControls(!!statusData.paused, wfNames);
      var historyNames = [];
      var seen = {};
      for (var i = 0; i < _allRecentRuns.length; i++) {
        var name = _allRecentRuns[i].workflow;
        if (name && !seen[name]) { seen[name] = true; historyNames.push(name); }
      }
      historyNames.sort();
      renderHistoryFilter(historyNames);
      applyHistoryFilter();
    } catch {}
  }

  var _daemonEventsSource = null;
  var _daemonEventsRetryTimer = null;

  function connectDaemonEvents() {
    if (_daemonEventsSource) return;
    var src = new EventSource(API + "/api/daemon/events");
    _daemonEventsSource = src;

    function onQueueEvent() { refreshWorkflows(); }
    src.addEventListener("workflow.started", onQueueEvent);
    src.addEventListener("workflow.completed", onQueueEvent);
    src.addEventListener("workflow.step.completed", onQueueEvent);
    src.addEventListener("queue.changed", onQueueEvent);
    src.addEventListener("approval.changed", function() { refreshApprovals(); });
    src.addEventListener("task.changed", function() { refreshTasks(); });

    src.onerror = function() {
      src.close();
      _daemonEventsSource = null;
      _daemonEventsRetryTimer = setTimeout(connectDaemonEvents, 10000);
    };
  }

  function startWorkflowUpdates() {
    connectDaemonEvents();
  }
`;
